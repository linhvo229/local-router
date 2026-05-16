#!/usr/bin/env node
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureNetworkFromEnv } from "./proxy-env.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { AccountPool } from "./accounts.js";
import { proxyOpenAI, readUpstreamError } from "./openai.js";
import { proxyCodex, readCodexError } from "./codex/proxy.js";
import { ensureCodexAccessToken } from "./codex/token.js";
import { lowerHeaders, pipeResponse, readJson, sendJson } from "./http.js";

configureNetworkFromEnv();

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
    return proxyWithAccountFallback(req, res, { model: null, body: undefined });
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

  return proxyWithAccountFallback(req, res, { model, body });
}

async function proxyWithAccountFallback(req, res, { model, body }) {
  const excluded = new Set();
  let lastError = "No account available";
  let lastStatus = 503;

  while (true) {
    const account = model ? pool.pick({ model, excluded }) : pool.pickAny({ excluded });
    if (!account) {
      return sendJson(res, lastStatus, { error: { message: lastError } });
    }

    let credential;
    try {
      credential = await resolveCredential(account);
    } catch (error) {
      excluded.add(account.id);
      lastError = error.message;
      continue;
    }

    pool.markSelected(account.id);
    logger.info(`Routing ${model || "models"} via ${account.name || account.id}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.upstream?.timeoutMs || 600000));
    req.on("aborted", () => controller.abort(), { once: true });

    let upstream;
    try {
      upstream = await proxyByProvider({ req, body, account, credential, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      lastError = error.name === "AbortError" ? "Upstream request aborted or timed out" : error.message;
      if (error.shouldLockAccount === false) {
        excluded.add(account.id);
        lastStatus = error.statusCode || 400;
        continue;
      }
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
      return pipeResponse(upstream.response, res, { "x-local-router-account": account.id });
    }

    const errorInfo = await readProviderError(account, upstream.response);
    const errorMessage = errorInfo.message;
    lastError = `[${account.id}] ${errorMessage}`;
    lastStatus = upstream.response.status;
    const decision = pool.markFailure(account.id, model, upstream.response.status, { untilMs: errorInfo.resetsAtMs });
    if (decision.shouldFallback) {
      excluded.add(account.id);
      continue;
    }

    return sendJson(res, upstream.response.status, { error: { message: errorMessage } });
  }
}

async function resolveCredential(account) {
  if ((account.provider || "openai") === "codex") {
    return ensureCodexAccessToken(account, { onRefresh: saveRuntimeConfig });
  }
  return pool.resolveApiKey(account);
}

function proxyByProvider({ req, body, account, credential, signal }) {
  if ((account.provider || "openai") === "codex") {
    return proxyCodex({ req, body, account, accessToken: credential, signal });
  }
  return proxyOpenAI({ req, body, account, apiKey: credential, config, signal });
}

async function readProviderError(account, response) {
  if ((account.provider || "openai") === "codex") return readCodexError(response);
  return { message: await readUpstreamError(response), resetsAtMs: null };
}

async function saveRuntimeConfig() {
  const configPath = expandHome(process.env.LOCAL_ROUTER_CONFIG || "./config.json");
  if (!fs.existsSync(configPath)) return;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function expandHome(filePath) {
  if (!filePath || !filePath.startsWith("~")) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function isSupportedPath(pathname) {
  return pathname === "/v1/chat/completions" || pathname === "/v1/responses";
}

function isAuthorized(headers) {
  const auth = headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const key = bearer || headers["x-api-key"];
  return Boolean(key && config.localApiKeys.some((localKey) => safeEqual(key, localKey)));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

server.listen(config.listen.port, config.listen.host, () => {
  logger.info(`local-router listening on http://${config.listen.host}:${config.listen.port}`);
});
