export function createLogger(config = {}) {
  const privacy = config.privacy || {};

  function line(level, message, meta) {
    const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`);
  }

  return {
    info: (message, meta) => line("info", message, meta),
    warn: (message, meta) => line("warn", message, meta),
    error: (message, meta) => line("error", message, meta),
    request: (method, path, model) => line("request", `${method} ${path}${model ? ` model=${model}` : ""}`),
    body: (label, body) => {
      if (privacy.logBodies) line("debug", label, body);
    },
    headers: (label, headers) => {
      if (privacy.logHeaders) line("debug", label, maskHeaders(headers));
    },
  };
}

export function maskKey(key) {
  if (!key) return "";
  if (key.length <= 10) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function maskHeaders(headers) {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (["authorization", "x-api-key"].includes(key.toLowerCase())) out[key] = "***";
  }
  return out;
}
