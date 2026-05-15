import { matchesModel } from "./match.js";

export class AccountPool {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.state = new Map();
    for (const account of config.accounts) {
      this.state.set(account.id, {
        lastUsedAt: 0,
        consecutiveUseCount: 0,
        locks: new Map(),
      });
    }
  }

  list() {
    return this.config.accounts.map((account) => this.publicAccount(account));
  }

  publicAccount(account) {
    const state = this.state.get(account.id);
    return {
      id: account.id,
      name: account.name || account.id,
      enabled: account.enabled !== false,
      priority: account.priority || 999,
      lastUsedAt: state?.lastUsedAt || null,
      locks: Object.fromEntries(state?.locks || []),
    };
  }

  pick({ model, excluded = new Set() } = {}) {
    const candidates = this.config.accounts
      .filter((account) => account.enabled !== false)
      .filter((account) => !excluded.has(account.id))
      .filter((account) => matchesModel(model || "", account.models || {}))
      .filter((account) => !this.isLocked(account.id, model))
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));

    if (candidates.length === 0) return null;
    if (this.config.strategy === "fill-first") return candidates[0];
    return this.pickRoundRobin(candidates);
  }

  pickRoundRobin(candidates) {
    const stickyLimit = Math.max(1, Number(this.config.stickyRequests || 1));
    const byRecent = [...candidates].sort((a, b) => {
      const sa = this.state.get(a.id);
      const sb = this.state.get(b.id);
      return (sb?.lastUsedAt || 0) - (sa?.lastUsedAt || 0);
    });

    const current = byRecent[0];
    const currentState = this.state.get(current.id);
    if (currentState?.lastUsedAt && currentState.consecutiveUseCount < stickyLimit) {
      return current;
    }

    return [...candidates].sort((a, b) => {
      const sa = this.state.get(a.id);
      const sb = this.state.get(b.id);
      const diff = (sa?.lastUsedAt || 0) - (sb?.lastUsedAt || 0);
      return diff || ((a.priority || 999) - (b.priority || 999));
    })[0];
  }

  markSelected(accountId) {
    const state = this.state.get(accountId);
    if (!state) return;
    const now = Date.now();
    if (state.lastUsedAt > 0 && now - state.lastUsedAt < 60_000) {
      state.consecutiveUseCount += 1;
    } else {
      state.consecutiveUseCount = 1;
    }
    state.lastUsedAt = now;
  }

  markSuccess(accountId, model) {
    const state = this.state.get(accountId);
    if (!state) return;
    state.locks.delete(lockKey(model));
    state.locks.delete(lockKey(null));
  }

  markFailure(accountId, model, status) {
    const seconds = this.cooldownSeconds(status);
    if (!seconds) return { shouldFallback: false, cooldownSeconds: 0 };

    const state = this.state.get(accountId);
    if (!state) return { shouldFallback: false, cooldownSeconds: 0 };
    const key = lockKey(model);
    const until = Date.now() + seconds * 1000;
    state.locks.set(key, until);
    this.logger.warn(`Account ${accountId} locked for ${seconds}s`, { status, model: model || "all" });
    return { shouldFallback: true, cooldownSeconds: seconds };
  }

  isLocked(accountId, model) {
    const state = this.state.get(accountId);
    if (!state) return false;
    const now = Date.now();
    for (const key of [lockKey(model), lockKey(null)]) {
      const until = state.locks.get(key);
      if (!until) continue;
      if (until > now) return true;
      state.locks.delete(key);
    }
    return false;
  }

  cooldownSeconds(status) {
    const cooldown = this.config.cooldown || {};
    if (status === 429) return Number(cooldown.rateLimitSeconds || 300);
    if (status === 401 || status === 403) return Number(cooldown.authErrorSeconds || 3600);
    if (status >= 500 && status <= 599) return Number(cooldown.serverErrorSeconds || 60);
    return 0;
  }

  resolveApiKey(account) {
    const key = account.apiKeyEnv ? process.env[account.apiKeyEnv] : account.apiKey;
    if (!key) throw new Error(`Missing API key for account ${account.id}`);
    return key;
  }
}

function lockKey(model) {
  return model ? `model:${model}` : "model:*";
}
