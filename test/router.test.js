import test from "node:test";
import assert from "node:assert/strict";
import { AccountPool } from "../src/accounts.js";
import { buildCodexAuthUrl, generatePkce } from "../src/codex/oauth.js";
import { parseCodexQuota } from "../src/codex/quota.js";
import { CodexReauthRequiredError, refreshCodexAccount } from "../src/codex/token.js";
import { transformCodexRequest, UnsupportedCodexPathError } from "../src/codex/transform.js";
import { readJson } from "../src/http.js";
import { globMatch, matchesModel } from "../src/match.js";

const config = {
  strategy: "round-robin",
  stickyRequests: 1,
  cooldown: { rateLimitSeconds: 60, authErrorSeconds: 600, serverErrorSeconds: 10 },
  accounts: [
    { id: "a", name: "A", apiKey: "sk-a", priority: 1, enabled: true, models: { allow: ["gpt-5*"] } },
    { id: "b", name: "B", apiKey: "sk-b", priority: 2, enabled: true, models: { allow: ["*"] } },
  ],
};

test("globMatch supports star patterns", () => {
  assert.equal(globMatch("gpt-5.1", "gpt-5*"), true);
  assert.equal(globMatch("gpt-4o", "gpt-5*"), false);
});

test("matchesModel applies allow and deny", () => {
  assert.equal(matchesModel("gpt-5.1", { allow: ["gpt-*"], deny: ["gpt-4*"] }), true);
  assert.equal(matchesModel("gpt-4.1", { allow: ["gpt-*"], deny: ["gpt-4*"] }), false);
});

test("AccountPool selects eligible accounts and respects cooldown", () => {
  const pool = new AccountPool(config, { warn() {} });
  const first = pool.pick({ model: "gpt-5.1" });
  assert.equal(first.id, "a");
  pool.markFailure("a", "gpt-5.1", 429);
  const fallback = pool.pick({ model: "gpt-5.1" });
  assert.equal(fallback.id, "b");
});

test("AccountPool skips accounts outside model allowlist", () => {
  const pool = new AccountPool(config, { warn() {} });
  const account = pool.pick({ model: "gpt-4o" });
  assert.equal(account.id, "b");
});

test("pickAny is not constrained by model allowlists", () => {
  const pool = new AccountPool(config, { warn() {} });
  const account = pool.pickAny();
  assert.equal(account.id, "a");
});

test("readJson rejects bodies over maxBytes", async () => {
  async function* req() {
    yield Buffer.from('{"model":"gpt-4o-mini"}');
  }

  await assert.rejects(
    () => readJson(req(), { maxBytes: 5 }),
    (error) => error.statusCode === 413,
  );
});


test("Codex OAuth URL includes PKCE and Codex params", () => {
  const pkce = generatePkce();
  assert.equal(pkce.codeVerifier.length > 20, true);
  const authUrl = new URL(buildCodexAuthUrl({ codeChallenge: "challenge", state: "state" }));
  assert.equal(authUrl.hostname, "auth.openai.com");
  assert.equal(authUrl.searchParams.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.equal(authUrl.searchParams.get("code_challenge"), "challenge");
  assert.equal(authUrl.searchParams.get("codex_cli_simplified_flow"), "true");
});

test("parseCodexQuota normalizes session and review windows", () => {
  const quota = parseCodexQuota({
    plan_type: "plus",
    rate_limit: {
      session: { used_percent: 30, reset_at: 2000000000 },
      weekly: { remaining_percent: 40, reset_at: 2000000000 },
    },
    rate_limits_by_limit_id: {
      codex_review: {
        session: { used_percent: 10 },
        weekly: { remaining_percent: 80 },
      },
    },
  });
  assert.equal(quota.plan, "plus");
  assert.equal(quota.quotas.session.remaining, 70);
  assert.equal(quota.quotas.weekly.used, 60);
  assert.equal(quota.quotas.review_session.remaining, 90);
  assert.equal(quota.quotas.review_weekly.used, 20);
});

test("transformCodexRequest forces Codex response shape", () => {
  const transformed = transformCodexRequest("/v1/responses", {
    model: "gpt-5.3-codex-high",
    input: "hello",
    temperature: 1,
  }, "gpt-5.3-codex-high");
  assert.equal(transformed.model, "gpt-5.3-codex");
  assert.equal(transformed.stream, true);
  assert.equal(transformed.store, false);
  assert.equal(transformed.reasoning.effort, "high");
  assert.equal(transformed.include.includes("reasoning.encrypted_content"), true);
  assert.equal("temperature" in transformed, false);
});


test("Codex chat-completions transform is non-locking client error", () => {
  assert.throws(
    () => transformCodexRequest("/v1/chat/completions", { model: "gpt-5.3-codex" }, "gpt-5.3-codex"),
    (error) => error instanceof UnsupportedCodexPathError && error.statusCode === 400 && error.shouldLockAccount === false,
  );
});

test("Codex refresh classifies unrecoverable errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  try {
    await assert.rejects(
      () => refreshCodexAccount({ id: "codex-1", refreshToken: "refresh" }),
      (error) => error instanceof CodexReauthRequiredError && error.code === "invalid_grant",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
