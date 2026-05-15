import { CODEX_CLIENT_ID, CODEX_SCOPE, CODEX_TOKEN_URL, mapTokenResponse } from "./oauth.js";

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const UNRECOVERABLE_REFRESH_ERRORS = new Set([
  "refresh_token_reused",
  "invalid_grant",
  "token_expired",
  "invalid_token",
]);

export class CodexReauthRequiredError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CodexReauthRequiredError";
    this.code = code;
    this.shouldLockAccount = false;
  }
}

export function needsRefresh(account, now = Date.now()) {
  if (!account.refreshToken) return false;
  if (!account.accessToken || !account.expiresAt) return true;
  const expiresAt = Date.parse(account.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt - now <= REFRESH_SKEW_MS;
}

export async function refreshCodexAccount(account) {
  if (!account.refreshToken) throw new Error(`Missing Codex refresh token for account ${account.id}`);
  const response = await fetch(CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: CODEX_SCOPE,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    const code = parseRefreshErrorCode(text);
    if (UNRECOVERABLE_REFRESH_ERRORS.has(code)) {
      throw new CodexReauthRequiredError(`Codex refresh token is no longer valid (${code}). Run codex logout/login for account ${account.id}.`, code);
    }
    throw new Error(`Codex token refresh failed: ${text || response.status}`);
  }
  const mapped = mapTokenResponse(await response.json());
  account.accessToken = mapped.accessToken;
  account.refreshToken = mapped.refreshToken || account.refreshToken;
  account.expiresAt = mapped.expiresAt;
  return account;
}

export async function ensureCodexAccessToken(account, { onRefresh } = {}) {
  if (needsRefresh(account)) {
    await refreshCodexAccount(account);
    await onRefresh?.(account);
  }
  if (!account.accessToken) throw new Error(`Missing Codex access token for account ${account.id}`);
  return account.accessToken;
}

function parseRefreshErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.code || (typeof parsed?.error === "string" ? parsed.error : null);
  } catch {
    return null;
  }
}
