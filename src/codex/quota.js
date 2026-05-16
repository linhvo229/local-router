const CODEX_USAGE_ENDPOINTS = [
  "https://chatgpt.com/backend-api/wham/usage",
  "https://chatgpt.com/backend-api/api/codex/usage",
  "https://chatgpt.com/backend-api/codex/usage",
];

export async function getCodexQuota(accessToken, { accountId, signal } = {}) {
  const errors = [];
  let fallbackQuota = null;
  for (const endpoint of CODEX_USAGE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: cleanHeaders({
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          originator: "codex-cli",
          "User-Agent": "codex-cli/1.0.18 (macOS; arm64)",
          "ChatGPT-Account-ID": accountId,
        }),
        signal,
      });
      if (response.ok) {
        const quota = parseCodexQuota(await response.json());
        if (hasWeeklyQuota(quota)) return quota;
        fallbackQuota ||= quota;
        continue;
      }
      errors.push(`${endpoint}: ${response.status} ${await response.text()}`);
    } catch (error) {
      errors.push(`${endpoint}: ${formatFetchError(error)}`);
      if (error.name === "AbortError") throw error;
    }
  }
  if (fallbackQuota) return fallbackQuota;
  throw new Error(`Codex quota fetch failed: ${errors.join("; ")}`);
}

function hasWeeklyQuota(quota) {
  return Boolean(quota?.quotas?.weekly || quota?.quotas?.review_weekly);
}

function formatFetchError(error) {
  const details = [error.message];
  if (error.cause?.code) details.push(error.cause.code);
  if (error.cause?.message && error.cause.message !== error.message) details.push(error.cause.message);
  return details.filter(Boolean).join(" - ");
}

function cleanHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value != null && value !== ""));
}

export function parseCodexQuota(data) {
  const normalRateLimit = data.rate_limit || data.rate_limits || data.rate_limits_by_limit_id?.codex || {};
  const reviewRateLimit = getReviewRateLimit(data);
  const quotas = {};
  appendQuotaWindows(quotas, "", normalRateLimit);
  appendQuotaWindows(quotas, "review", reviewRateLimit);
  return {
    plan: data.plan_type || data.summary?.plan || data.plan || "unknown",
    limitReached: Boolean(rateLimitBody(normalRateLimit)?.limit_reached),
    reviewLimitReached: Boolean(rateLimitBody(reviewRateLimit)?.limit_reached),
    quotas,
  };
}

function getReviewRateLimit(data) {
  if (data.code_review_rate_limit) return data.code_review_rate_limit;
  if (data.review_rate_limit) return data.review_rate_limit;
  const byLimitId = data.rate_limits_by_limit_id || {};
  if (byLimitId.code_review || byLimitId.codex_review || byLimitId.review) {
    return byLimitId.code_review || byLimitId.codex_review || byLimitId.review;
  }
  for (const [id, value] of Object.entries(byLimitId)) {
    if (id === "code_review" || id === "codex_review" || id === "review" || id.includes("review")) return value;
  }
  return null;
}

function appendQuotaWindows(quotas, prefix, rateLimit) {
  const body = rateLimitBody(rateLimit);
  if (!body) return;
  appendWindow(quotas, prefix ? `${prefix}_session` : "session", body, ["session", "primary", "short"]);
  appendWindow(quotas, prefix ? `${prefix}_weekly` : "weekly", body, ["weekly", "long"]);
}

function rateLimitBody(value) {
  if (!value) return null;
  if (value.rate_limit) return value.rate_limit;
  return value;
}

function appendWindow(quotas, name, body, keys) {
  const window = pickWindow(body, keys);
  if (!window) return;
  const used = percent(window.used_percent ?? window.usedPercentage ?? window.percent_used ?? window.used);
  const remaining = percent(window.remaining_percent ?? window.remainingPercentage ?? window.percent_remaining ?? window.remaining);
  const finalUsed = used ?? (remaining == null ? null : 100 - remaining);
  const finalRemaining = remaining ?? (used == null ? null : 100 - used);
  quotas[name] = {
    used: finalUsed,
    total: 100,
    remaining: finalRemaining,
    resetAt: parseResetAt(window.reset_at ?? window.resets_at ?? window.resetAt ?? window.resetsAt ?? window.reset_time),
  };
}

function pickWindow(body, keys) {
  for (const key of keys) {
    if (body[key]) return body[key];
    if (body[`${key}_window`]) return body[`${key}_window`];
    if (body[`${key}_limit`]) return body[`${key}_limit`];
  }
  return null;
}

function percent(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function parseResetAt(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const ms = number > 10_000_000_000 ? number : number * 1000;
  return new Date(ms).toISOString();
}
