import { transformCodexRequest, codexSessionId } from "./transform.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export async function proxyCodex({ req, body, account, accessToken, signal }) {
  const incomingUrl = new URL(req.url, "http://localhost");
  const transformed = transformCodexRequest(incomingUrl.pathname, body, body?.model);
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: "codex-cli",
      "User-Agent": "codex-cli/1.0.18 (macOS; arm64)",
      session_id: codexSessionId(account, transformed),
    },
    body: JSON.stringify(transformed),
    signal,
  });
  return { response, upstreamUrl: CODEX_RESPONSES_URL, accountId: account.id };
}

export async function readCodexError(response) {
  const text = await response.text();
  if (!text) return { message: `HTTP ${response.status}`, resetsAtMs: null };
  try {
    const parsed = JSON.parse(text);
    const error = parsed.error || parsed;
    return {
      message: error.message || text,
      resetsAtMs: parseCodexReset(error),
    };
  } catch {
    return { message: text, resetsAtMs: null };
  }
}

export function parseCodexReset(error) {
  if (!error || error.type !== "usage_limit_reached") return null;
  const now = Date.now();
  if (typeof error.resets_at === "number" && error.resets_at > 0) {
    const ms = error.resets_at > 10_000_000_000 ? error.resets_at : error.resets_at * 1000;
    if (ms > now) return ms;
  }
  if (typeof error.resets_in_seconds === "number" && error.resets_in_seconds > 0) {
    return now + error.resets_in_seconds * 1000;
  }
  return null;
}
