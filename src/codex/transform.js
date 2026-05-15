import crypto from "node:crypto";

export const CODEX_DEFAULT_INSTRUCTIONS = "You are Codex, a coding agent. Be concise, correct, and preserve user code unless asked to change it.";

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export class UnsupportedCodexPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedCodexPathError";
    this.statusCode = 400;
    this.shouldLockAccount = false;
  }
}

export function transformCodexRequest(pathname, body, model) {
  if (pathname === "/v1/chat/completions") {
    throw new UnsupportedCodexPathError("Codex provider currently supports /v1/responses only. Use an OpenAI API key account for /v1/chat/completions.");
  }
  const output = structuredClone(body || {});
  output.model = normalizeModel(output.model || model, output);
  output.input = normalizeInput(output.input);
  output.stream = true;
  output.store = false;
  if (!output.instructions || !String(output.instructions).trim()) output.instructions = CODEX_DEFAULT_INSTRUCTIONS;
  ensureReasoning(output);
  stripUnsupported(output);
  return output;
}

function normalizeModel(model, body) {
  let result = String(model || "gpt-5.3-codex");
  const suffix = result.split("-").at(-1);
  if (EFFORTS.has(suffix)) {
    body.reasoning_effort ||= suffix;
    result = result.slice(0, -(suffix.length + 1));
  }
  return result;
}

function normalizeInput(input) {
  if (Array.isArray(input) && input.length > 0) return input;
  if (typeof input === "string" && input.trim()) {
    return [{ type: "message", role: "user", content: [{ type: "input_text", text: input }] }];
  }
  return [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
}

function ensureReasoning(body) {
  if (!body.reasoning) {
    const effort = body.reasoning_effort || "low";
    body.reasoning = { effort, summary: "auto" };
  } else if (!body.reasoning.summary) {
    body.reasoning.summary = "auto";
  }
  delete body.reasoning_effort;
  if (body.reasoning?.effort && body.reasoning.effort !== "none") {
    body.include = Array.from(new Set([...(body.include || []), "reasoning.encrypted_content"]));
  }
}

function stripUnsupported(body) {
  for (const key of [
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "logprobs",
    "top_logprobs",
    "n",
    "seed",
    "max_tokens",
    "max_completion_tokens",
  ]) {
    delete body[key];
  }
}

export function codexSessionId(account, body) {
  const hash = crypto.createHash("sha256");
  hash.update(account.id || "codex");
  hash.update("\0");
  hash.update(JSON.stringify(body?.input || []));
  return hash.digest("hex").slice(0, 32);
}
