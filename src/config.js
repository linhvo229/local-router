import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG = {
  listen: { host: "127.0.0.1", port: 8787 },
  requireApiKey: true,
  localApiKeys: [],
  strategy: "round-robin",
  stickyRequests: 3,
  upstream: { baseUrl: "https://api.openai.com/v1", timeoutMs: 600000 },
  cooldown: { rateLimitSeconds: 300, authErrorSeconds: 3600, serverErrorSeconds: 60 },
  privacy: { logBodies: false, logHeaders: false },
  accounts: [],
};

function expandHome(filePath) {
  if (!filePath || !filePath.startsWith("~")) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function warnLoosePermissions(filePath, logger) {
  if (process.platform === "win32") return;
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      logger.warn(`Config file is group/world-readable (${mode.toString(8)}). Consider: chmod 600 ${filePath}`);
    }
  } catch {
    // Ignore permission warning when stat is unavailable.
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function loadConfig(logger = console) {
  const configPath = expandHome(process.env.LOCAL_ROUTER_CONFIG || "./config.json");
  let userConfig = {};
  if (fs.existsSync(configPath)) {
    userConfig = loadJson(configPath);
    warnLoosePermissions(configPath, logger);
  } else if (!process.env.LOCAL_ROUTER_CONFIG) {
    logger.warn("No config.json found; using defaults. Copy config.example.json to config.json first.");
  } else {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const config = deepMerge(DEFAULT_CONFIG, userConfig);
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error("At least one account is required in config.accounts");
  }
  if (config.requireApiKey && (!Array.isArray(config.localApiKeys) || config.localApiKeys.length === 0)) {
    throw new Error("requireApiKey=true requires at least one localApiKeys entry");
  }
  if (!["round-robin", "fill-first"].includes(config.strategy)) {
    throw new Error("strategy must be round-robin or fill-first");
  }

  const ids = new Set();
  for (const account of config.accounts) {
    if (!account.id) throw new Error("Every account needs an id");
    if (ids.has(account.id)) throw new Error(`Duplicate account id: ${account.id}`);
    ids.add(account.id);
    if (!account.apiKey && !account.apiKeyEnv) {
      throw new Error(`Account ${account.id} needs apiKey or apiKeyEnv`);
    }
  }
}
