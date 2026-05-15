import { Readable } from "node:stream";

export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export async function pipeResponse(upstream, res, extraHeaders = {}) {
  const headers = {};
  for (const [key, value] of upstream.headers.entries()) {
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  Object.assign(headers, extraHeaders);
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();

  return new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", (error) => {
      res.destroy(error);
      reject(error);
    });
    res.on("error", reject);
    res.on("finish", resolve);
    stream.pipe(res);
  });
}

export async function readJson(req, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body too large: ${total} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function lowerHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[key.toLowerCase()] = value;
  return out;
}
