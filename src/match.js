export function matchesModel(model, rules = {}) {
  const allow = Array.isArray(rules.allow) && rules.allow.length ? rules.allow : ["*"];
  const deny = Array.isArray(rules.deny) ? rules.deny : [];
  const candidates = modelCandidates(model);
  return allow.some((pattern) => candidates.some((candidate) => globMatch(candidate, pattern)))
    && !deny.some((pattern) => candidates.some((candidate) => globMatch(candidate, pattern)));
}

function modelCandidates(model) {
  const value = String(model || "");
  const slashIndex = value.lastIndexOf("/");
  if (slashIndex === -1) return [value];
  return [value, value.slice(slashIndex + 1)];
}

export function globMatch(value, pattern) {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
