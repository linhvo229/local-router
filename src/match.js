export function matchesModel(model, rules = {}) {
  const allow = Array.isArray(rules.allow) && rules.allow.length ? rules.allow : ["*"];
  const deny = Array.isArray(rules.deny) ? rules.deny : [];
  return allow.some((pattern) => globMatch(model, pattern)) && !deny.some((pattern) => globMatch(model, pattern));
}

export function globMatch(value, pattern) {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}
