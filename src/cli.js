#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const CONFIG_PATH = process.env.LOCAL_ROUTER_CONFIG || "config.json";

async function main() {
  const [command, subcommand, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") return printHelp();
  if (command === "start" || command === "serve") return import("./server.js");
  if (command === "init") return initConfig(args);
  if (command === "account" && subcommand === "list") return listAccounts();
  if (command === "account" && subcommand === "add") return addAccount(args);

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

Environment:
  LOCAL_ROUTER_CONFIG  Path to config.json (default: ./config.json)
`);
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}. Run: local-router init`);
  }
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
  if (fs.existsSync(CONFIG_PATH) && !flags.force) {
    throw new Error(`${CONFIG_PATH} already exists. Use --force to overwrite.`);
  }

  const examplePath = new URL("../config.example.json", import.meta.url);
  const config = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  config.localApiKeys = [`local-${crypto.randomBytes(24).toString("base64url")}`];
  writeConfig(config);
  console.log(`Created ${CONFIG_PATH}`);
  console.log("Next: edit config.json and replace PASTE_OPENAI_API_KEY_HERE with your OpenAI API key.");
}

async function listAccounts() {
  const config = readConfig();
  for (const account of config.accounts || []) {
    const keySource = account.apiKeyEnv ? `env:${account.apiKeyEnv}` : account.apiKey ? "inline" : "missing";
    const status = account.enabled === false ? "disabled" : "enabled";
    console.log(`${account.id}\t${status}\tpriority=${account.priority ?? 999}\tkey=${keySource}\t${account.name || ""}`);
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

    const priority = Number(flags.priority || config.accounts.length + 1);
    const account = {
      id,
      name,
      priority,
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

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
