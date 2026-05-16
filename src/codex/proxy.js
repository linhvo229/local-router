import { transformCodexRequest, codexSessionId } from "./transform.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

export async function proxyCodex({ req, body, account, accessToken, signal }) {
  const incomingUrl = new URL(req.url, "http://localhost");
  const transformed = transformCodexRequest(incomingUrl.pathname, body, body?.model);
  const isChatCompletions = incomingUrl.pathname === "/v1/chat/completions";
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: "codex-cli",
      "User-Agent": "codex-cli/1.0.18 (macOS; arm64)",
      session_id: codexSessionId(account, transformed),
    },
    body: JSON.stringify(transformed),
    signal,
  });
  return {
    response: isChatCompletions && response.ok ? toChatCompletionStream(response, transformed.model) : response,
    upstreamUrl: CODEX_RESPONSES_URL,
    accountId: account.id,
  };
}

function toChatCompletionStream(response, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-${cryptoRandomId()}`;
  let buffer = "";
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`));
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) emitCodexLine(controller, encoder, line, id, model);
        }
        if (buffer) emitCodexLine(controller, encoder, buffer, id, model);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function emitCodexLine(controller, encoder, line, id, model) {
  if (!line.startsWith("data:")) return;
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  const text = extractTextDelta(event);
  if (text) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`));
  }
  const finishReason = extractFinishReason(event);
  if (finishReason) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`));
  }
}

function extractTextDelta(event) {
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") return event.delta;
  if (event.type === "response.refusal.delta" && typeof event.delta === "string") return event.delta;
  if (event.type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") return event.delta;
  if (event.type === "response.output_text.delta" && typeof event.text === "string") return event.text;
  return "";
}

function extractFinishReason(event) {
  if (event.type === "response.completed" || event.type === "response.done") return "stop";
  return event.finish_reason || null;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 12);
}

export async function readCodexError(response) {
  const text = await response.text();
  if (!text) return { message: `HTTP ${response.status}`, resetsAtMs: null };
  try {
    const parsed = JSON.parse(text);
    const error = parsed.error || parsed;
    return {
      message: error.message || text,
      resetsAtMs: parseCodexReset(error),
    };
  } catch {
    return { message: text, resetsAtMs: null };
  }
}

export function parseCodexReset(error) {
  if (!error || error.type !== "usage_limit_reached") return null;
  const now = Date.now();
  if (typeof error.resets_at === "number" && error.resets_at > 0) {
    const ms = error.resets_at > 10_000_000_000 ? error.resets_at : error.resets_at * 1000;
    if (ms > now) return ms;
  }
  if (typeof error.resets_in_seconds === "number" && error.resets_in_seconds > 0) {
    return now + error.resets_in_seconds * 1000;
  }
  return null;
}
