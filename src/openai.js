export async function proxyOpenAI({ req, body, account, apiKey, config, signal }) {
  const upstreamBase = (config.upstream?.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const incomingUrl = new URL(req.url, "http://localhost");
  const upstreamUrl = `${upstreamBase}${incomingUrl.pathname}${incomingUrl.search}`;
  const headers = buildUpstreamHeaders(req.headers, apiKey);

  const response = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  return { response, upstreamUrl, accountId: account.id };
}

function buildUpstreamHeaders(incomingHeaders, apiKey) {
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const accept = incomingHeaders.accept;
  if (accept) headers.Accept = accept;
  const org = incomingHeaders["openai-organization"] || incomingHeaders["OpenAI-Organization"];
  if (org) headers["OpenAI-Organization"] = org;
  const project = incomingHeaders["openai-project"] || incomingHeaders["OpenAI-Project"];
  if (project) headers["OpenAI-Project"] = project;
  return headers;
}

export async function readUpstreamError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      return parsed?.error?.message || parsed?.message || text;
    } catch {
      return text;
    }
  }
  return text || `HTTP ${response.status}`;
}
