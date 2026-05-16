import crypto from "node:crypto";
import http from "node:http";
import { execFile } from "node:child_process";

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

export function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  return { codeVerifier, codeChallenge, state };
}

export function buildCodexAuthUrl({ codeChallenge, state }) {
  const params = {
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    scope: CODEX_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
    state,
  };
  const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `${CODEX_AUTHORIZE_URL}?${query}`;
}

export async function codexLogin() {
  const pkce = generatePkce();
  const callback = waitForCallback(pkce.state);
  const authUrl = buildCodexAuthUrl({ codeChallenge: pkce.codeChallenge, state: pkce.state });

  console.log("Open this URL to authorize Codex:");
  console.log(authUrl);
  openBrowser(authUrl);

  const { code } = await callback;
  const tokens = await exchangeCode({ code, codeVerifier: pkce.codeVerifier });
  return mapTokenResponse(tokens);
}

function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://localhost:1455");
      if (url.pathname !== "/auth/callback" && url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error) return finish({ res, ok: false, message: url.searchParams.get("error_description") || error, reject });
      if (!code || state !== expectedState) return finish({ res, ok: false, message: "Invalid OAuth callback", reject });
      finish({ res, ok: true, message: "Codex login complete. You can close this window.", resolve, value: { code } });
    });

    timeout = setTimeout(() => {
      finish({ ok: false, message: "Codex login timed out", reject });
    }, 5 * 60 * 1000);

    function finish({ res, ok, message, resolve, reject, value }) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const done = () => {
        if (ok) resolve(value);
        else reject(new Error(message));
        closeCallbackServer(server);
      };
      if (res) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" });
        res.end(`<html><body><h1>${ok ? "Success" : "Failed"}</h1><p>${escapeHtml(message)}</p></body></html>`, done);
      } else {
        done();
      }
    }

    server.listen(1455, "127.0.0.1");
    server.on("error", (error) => {
      const message = error.code === "EADDRINUSE"
        ? "Codex OAuth callback port 1455 is busy. Stop the process using it, then retry."
        : `Codex OAuth callback server failed: ${error.message}`;
      finish({ ok: false, message, reject });
    });
  });
}

function closeCallbackServer(server) {
  if (!server.listening) return;
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  server.close(() => {});
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function openBrowser(url) {
  const commands = process.platform === "win32"
    ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin"
      ? ["open", url]
      : ["xdg-open", url];
  execFile(commands[0], commands.slice(1), { stdio: "ignore" }, () => {});
}

export async function exchangeCode({ code, codeVerifier }) {
  const response = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      redirect_uri: CODEX_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) throw new Error(`Codex token exchange failed: ${await response.text()}`);
  return response.json();
}

export function mapTokenResponse(tokens) {
  const info = extractCodexAccountInfo(tokens.id_token || tokens.access_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
    email: info.email,
    chatgptAccountId: info.chatgptAccountId,
    chatgptPlanType: info.chatgptPlanType,
  };
}

export function extractCodexAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  if (!payload) return {};
  const chatgpt = payload["https://api.openai.com/auth"] || {};
  return {
    email: payload.email,
    chatgptAccountId: chatgpt.chatgpt_account_id,
    chatgptPlanType: chatgpt.chatgpt_plan_type,
  };
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
