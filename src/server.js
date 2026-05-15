#!/usr/bin/env node
import http from "node:http";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { AccountPool } from "./accounts.js";
import { proxyOpenAI, readUpstreamError } from "./openai.js";
import { lowerHeaders, pipeResponse, readJson, sendJson } from "./http.js";

const BOOT_LOGGER = createLogger({ privacy: { logBodies: false, logHeaders: false } });
const config = loadConfig(BOOT_LOGGER);
const logger = createLogger(config);
const pool = new AccountPool(config, logger);

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (error) {
    logger.error(error.stack || error.message || String(error));
    if (!res.headersSent) sendJson(res, 500, { error: { message: "local-router internal error" } });
    else res.destroy(error);
  }
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const headers = lowerHeaders(req.headers);

  if (config.requireApiKey && !isAuthorized(headers)) {
    return sendJson(res, 401, { error: { message: "Missing or invalid local API key" } });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, accounts: pool.list() });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return proxyWithoutAccountFallback(req, res);
  }

  if (req.method !== "POST" || !isSupportedPath(url.pathname)) {
    return sendJson(res, 404, { error: { message: "Not found" } });
  }

  let body;
  try {
    body = await readJson(req, { maxBytes: Number(config.maxBodyBytes) });
  } catch (error) {
    const status = error.statusCode || 400;
    const message = status === 413 ? error.message : "Invalid JSON body";
    return sendJson(res, status, { error: { message } });
  }

  const model = body?.model;
  if (!model) return sendJson(res, 400, { error: { message: "Missing model" } });

  logger.request(req.method, url.pathname, model);
  logger.body("client body", body);
  logger.headers("client headers", headers);

  const excluded = new Set();
  let lastError = "No account available";
  let lastStatus = 503;

  while (true) {
    const account = pool.pick({ model, excluded });
    if (!account) {
      return sendJson(res, lastStatus, { error: { message: lastError } });
    }

    let apiKey;
    try {
      apiKey = pool.resolveApiKey(account);
    } catch (error) {
      excluded.add(account.id);
      lastError = error.message;
      continue;
    }

    pool.markSelected(account.id);
    logger.info(`Routing ${model} via ${account.name || account.id}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.upstream?.timeoutMs || 600000));
    req.on("aborted", () => controller.abort());

    let upstream;
    try {
      upstream = await proxyOpenAI({ req, body, account, apiKey, config, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error.name === "AbortError" ? "Upstream request aborted or timed out" : error.message;
      lastStatus = 502;
      const decision = pool.markFailure(account.id, model, 502);
      if (decision.shouldFallback) {
        excluded.add(account.id);
        continue;
      }
      return sendJson(res, 502, { error: { message: lastError } });
    }
    clearTimeout(timeout);

    if (upstream.response.ok) {
      pool.markSuccess(account.id, model);
      res.setHeader("x-local-router-account", account.id);
      return pipeResponse(upstream.response, res, { "x-local-router-account": account.id });
    }

    const errorMessage = await readUpstreamError(upstream.response);
    lastError = `[${account.id}] ${errorMessage}`;
    lastStatus = upstream.response.status;
    const decision = pool.markFailure(account.id, model, upstream.response.status);
    if (decision.shouldFallback) {
      excluded.add(account.id);
      continue;
    }

    return sendJson(res, upstream.response.status, { error: { message: errorMessage } });
  }
}

async function proxyWithoutAccountFallback(req, res) {
  const account = pool.pickAny();
  if (!account) return sendJson(res, 503, { error: { message: "No account available" } });
  const apiKey = pool.resolveApiKey(account);
  const upstream = await proxyOpenAI({ req, body: undefined, account, apiKey, config });
  return pipeResponse(upstream.response, res, { "x-local-router-account": account.id });
}

function isSupportedPath(pathname) {
  return pathname === "/v1/chat/completions" || pathname === "/v1/responses";
}

function isAuthorized(headers) {
  const auth = headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const key = bearer || headers["x-api-key"];
  return key && config.localApiKeys.includes(key);
}

server.listen(config.listen.port, config.listen.host, () => {
  logger.info(`local-router listening on http://${config.listen.host}:${config.listen.port}`);
});
