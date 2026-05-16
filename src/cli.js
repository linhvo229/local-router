#!/usr/bin/env node
import crypto from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { codexLogin, extractCodexAccountInfo } from "./codex/oauth.js";
import { ensureCodexAccessToken } from "./codex/token.js";
import { getCodexQuota } from "./codex/quota.js";

const CONFIG_PATH = process.env.LOCAL_ROUTER_CONFIG || "config.json";

// Prefer IPv4 first because Node fetch can fail on some networks where IPv6 is advertised but unreachable.
dns.setDefaultResultOrder?.("ipv4first");

async function main() {
  const [command, subcommand, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "start" || command === "serve") return import("./server.js");
  if (command === "init") return initConfig(args);
  if (command === "account" && subcommand === "list") return listAccounts();
  if (command === "account" && subcommand === "add") return addAccount(args);
  if (command === "codex" && subcommand === "login") return codexLoginCommand(args);
  if (command === "codex" && subcommand === "list") return listCodexAccounts();
  if (command === "codex" && subcommand === "logout") return codexLogout(args);
  if (command === "quota") return quotaCommand([subcommand, ...args].filter(Boolean));

  console.error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  printHelp();
  process.exitCode = 1;
}

function printHelp() {
  console.log(`local-router

Usage:
  local-router start
  local-router init [--force]
  local-router account list
  local-router account add [--id openai-2] [--name "OpenAI 2"] [--key sk-...] [--env OPENAI_API_KEY]
  local-router codex login [--id codex-1] [--name "Codex 1"]
  local-router codex list
  local-router codex logout --id codex-1
  local-router quota [--account codex-1] [--json]

Environment:
  LOCAL_ROUTER_CONFIG  Path to config.json (default: ./config.json)
`);
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`Config not found: ${CONFIG_PATH}. Run: local-router init`);
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const item = args[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

async function initConfig(args) {
  const flags = parseFlags(args);
  if (fs.existsSync(CONFIG_PATH) && !flags.force) throw new Error(`${CONFIG_PATH} already exists. Use --force to overwrite.`);
  const examplePath = new URL("../config.example.json", import.meta.url);
  const config = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  config.localApiKeys = [`local-${crypto.randomBytes(24).toString("base64url")}`];
  writeConfig(config);
  console.log(`Created ${CONFIG_PATH}`);
  console.log("Next: edit config.json and replace PASTE_OPENAI_API_KEY_HERE with your OpenAI API key, or run codex login.");
}

async function listAccounts() {
  const config = readConfig();
  for (const account of config.accounts || []) {
    const provider = account.provider || "openai";
    const keySource = provider === "codex" ? "oauth" : account.apiKeyEnv ? `env:${account.apiKeyEnv}` : account.apiKey ? "inline" : "missing";
    const status = account.enabled === false ? "disabled" : "enabled";
    console.log(`${account.id}\t${provider}\t${status}\tpriority=${account.priority ?? 999}\tkey=${keySource}\t${account.name || ""}`);
  }
}

async function addAccount(args) {
  const flags = parseFlags(args);
  const config = readConfig();
  config.accounts ||= [];

  const rl = readline.createInterface({ input, output });
  try {
    const id = flags.id || await rl.question("Account id: ");
    if (!id) throw new Error("Account id is required");
    if (config.accounts.some((account) => account.id === id)) throw new Error(`Account already exists: ${id}`);

    const name = flags.name || await rl.question(`Name [${id}]: `) || id;
    const env = flags.env || "";
    const key = flags.key || (env ? "" : await rl.question("OpenAI API key (input is visible): "));
    if (!env && !key) throw new Error("Provide --env or an API key");

    const account = {
      id,
      name,
      provider: "openai",
      priority: Number(flags.priority || config.accounts.length + 1),
      enabled: true,
      models: { allow: ["*"] },
    };
    if (env) account.apiKeyEnv = env;
    else account.apiKey = key;

    config.accounts.push(account);
    writeConfig(config);
    console.log(`Added account ${id} to ${CONFIG_PATH}`);
  } finally {
    rl.close();
  }
}

async function codexLoginCommand(args) {
  const flags = parseFlags(args);
  const config = readConfig();
  config.accounts ||= [];
  const id = flags.id || "codex-1";
  if (config.accounts.some((account) => account.id === id)) throw new Error(`Account already exists: ${id}`);

  const tokens = await codexLogin();
  config.accounts.push({
    id,
    name: flags.name || id,
    provider: "codex",
    authType: "oauth",
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    expiresAt: tokens.expiresAt,
    email: tokens.email,
    chatgptAccountId: tokens.chatgptAccountId,
    chatgptPlanType: tokens.chatgptPlanType,
    priority: Number(flags.priority || config.accounts.length + 1),
    enabled: true,
    models: { allow: ["gpt-*-codex*"] },
  });
  writeConfig(config);
  console.log(`Added Codex account ${id} to ${CONFIG_PATH}`);
}

async function listCodexAccounts() {
  const config = readConfig();
  for (const account of codexAccounts(config)) {
    const status = account.enabled === false ? "disabled" : "enabled";
    console.log(`${account.id}\t${status}\texpires=${account.expiresAt || "unknown"}\t${account.name || ""}`);
  }
}

async function codexLogout(args) {
  const flags = parseFlags(args);
  if (!flags.id) throw new Error("codex logout requires --id");
  const config = readConfig();
  const before = config.accounts?.length || 0;
  config.accounts = (config.accounts || []).filter((account) => !(account.id === flags.id && (account.provider || "openai") === "codex"));
  if (config.accounts.length === before) throw new Error(`Codex account not found: ${flags.id}`);
  writeConfig(config);
  console.log(`Removed Codex account ${flags.id}`);
}

async function quotaCommand(args) {
  const flags = parseFlags(args);
  const config = readConfig();
  let accounts = codexAccounts(config);
  if (flags.account) accounts = accounts.filter((account) => account.id === flags.account);
  if (accounts.length === 0) throw new Error("No Codex accounts found");

  const rows = [];
  for (const account of accounts) {
    const accessToken = await ensureCodexAccessToken(account, { onRefresh: () => writeConfig(config) });
    const accountId = ensureChatGptAccountId(account, config);
    const quota = await getCodexQuota(accessToken, { accountId });
    rows.push({ id: account.id, provider: "codex", ...quota });
  }
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  printQuotaRows(rows);
}

function codexAccounts(config) {
  return (config.accounts || []).filter((account) => (account.provider || "openai") === "codex");
}

function ensureChatGptAccountId(account, config) {
  if (account.chatgptAccountId) return account.chatgptAccountId;
  const info = extractCodexAccountInfo(account.idToken || account.accessToken);
  if (!info.chatgptAccountId) {
    throw new Error(`Missing ChatGPT account id for ${account.id}. Run: local-router codex logout --id ${account.id} && local-router codex login --id ${account.id}`);
  }
  account.email = account.email || info.email;
  account.chatgptAccountId = info.chatgptAccountId;
  account.chatgptPlanType = account.chatgptPlanType || info.chatgptPlanType;
  writeConfig(config);
  return account.chatgptAccountId;
}

function printQuotaRows(rows) {
  console.log("Account\tPlan\tSession\tWeekly\tReview Session\tReview Weekly");
  for (const row of rows) {
    const q = row.quotas || {};
    console.log([row.id, row.plan || "unknown", formatQuota(q.session), formatQuota(q.weekly), formatQuota(q.review_session), formatQuota(q.review_weekly)].join("\t"));
  }
}

function formatQuota(quota) {
  if (!quota) return "-";
  const remaining = quota.remaining == null ? "?" : `${quota.remaining}%`;
  const reset = quota.resetAt ? ` reset ${quota.resetAt}` : "";
  return `${remaining} left${reset}`;
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
