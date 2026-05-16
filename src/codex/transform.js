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
  const output = pathname === "/v1/chat/completions" ? chatCompletionsToResponses(body || {}) : structuredClone(body || {});
  output.model = normalizeModel(output.model || model, output);
  output.input = normalizeInput(output.input);
  output.stream = true;
  output.store = false;
  if (!output.instructions || !String(output.instructions).trim()) output.instructions = CODEX_DEFAULT_INSTRUCTIONS;
  ensureReasoning(output);
  stripUnsupported(output);
  return output;
}

function chatCompletionsToResponses(body) {
  const instructions = [];
  const input = [];
  for (const message of body.messages || []) {
    if (!message) continue;
    if (message.role === "system") {
      const text = flattenContent(message.content);
      if (text) instructions.push(text);
      continue;
    }
    input.push({
      type: "message",
      role: normalizeRole(message.role),
      content: toResponseContent(message.content, message.role),
    });
  }
  const output = {
    ...body,
    instructions: instructions.join("\n\n") || body.instructions,
    input,
  };
  delete output.messages;
  delete output.input_messages;
  return output;
}

function normalizeRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function toResponseContent(content, role) {
  const type = role === "assistant" ? "output_text" : "input_text";
  if (Array.isArray(content)) {
    const parts = content.flatMap((part) => {
      if (typeof part === "string") return [{ type, text: part }];
      if (!part || typeof part !== "object") return [];
      if (part.type === "text" && typeof part.text === "string") return [{ type, text: part.text }];
      if (part.type === "image_url") return [{ type: "input_text", text: "[image omitted]" }];
      return typeof part.text === "string" ? [{ type, text: part.text }] : [];
    });
    return parts.length ? parts : [{ type, text: "" }];
  }
  return [{ type, text: content == null ? "" : String(content) }];
}

function flattenContent(content) {
  return toResponseContent(content, "user").map((part) => part.text).filter(Boolean).join("\n");
}

function normalizeModel(model, body) {
  let result = String(model || "gpt-5.3-codex");
  result = result.slice(result.lastIndexOf("/") + 1);
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
  for (const key of Object.keys(body)) {
    if (/^reason/i.test(key)) delete body[key];
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
    "stream_options",
    "steam_options",
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
