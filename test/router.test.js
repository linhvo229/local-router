import test from "node:test";
import assert from "node:assert/strict";
import { AccountPool } from "../src/accounts.js";
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
