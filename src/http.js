export function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function pipeResponse(upstream, res, extraHeaders = {}) {
  const headers = {};
  for (const [key, value] of upstream.headers.entries()) {
    if (["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }
  Object.assign(headers, extraHeaders);
  res.writeHead(upstream.status, headers);
  if (!upstream.body) return res.end();
  upstream.body.pipeTo(new WritableStream({
    write(chunk) {
      res.write(Buffer.from(chunk));
    },
    close() {
      res.end();
    },
    abort(error) {
      res.destroy(error);
    },
  })).catch((error) => res.destroy(error));
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function lowerHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[key.toLowerCase()] = value;
  return out;
}
