# local-router

A small local OpenAI account router with safe defaults. It exposes an OpenAI-compatible local endpoint and routes requests across multiple OpenAI API keys/accounts.

## Goals

- Route `/v1/chat/completions` and `/v1/responses` to OpenAI.
- Switch between multiple OpenAI accounts with `round-robin` or `fill-first`.
- Fallback to another account on `429`, `401`, `403`, `5xx`, or network errors.
- Bind to localhost by default and require a local API key.
- Avoid logging request/response bodies by default.

## Setup On macOS/Linux

```bash
git clone https://github.com/linhvo229/local-router.git
cd local-router
cp config.example.json config.json
chmod 600 config.json
```

Edit `config.json`, then export the upstream OpenAI keys referenced by `apiKeyEnv`:

```bash
export OPENAI_KEY_WORK_1="sk-..."
export OPENAI_KEY_PERSONAL_1="sk-..."
npm start
```

## Setup On Windows

Install Node.js 20+ first: https://nodejs.org

PowerShell:

```powershell
git clone https://github.com/linhvo229/local-router.git
cd local-router
Copy-Item config.example.json config.json
notepad config.json
```

Set the upstream OpenAI keys for the current PowerShell session:

```powershell
$env:OPENAI_KEY_WORK_1="sk-..."
$env:OPENAI_KEY_PERSONAL_1="sk-..."
npm start
```

Or persist them for future terminals:

```powershell
setx OPENAI_KEY_WORK_1 "sk-..."
setx OPENAI_KEY_PERSONAL_1 "sk-..."
```

Close and reopen PowerShell after `setx`, then run:

```powershell
npm start
```

The router listens on:

```text
http://127.0.0.1:8787/v1
```

Use the local key from `config.json` as the client API key.

macOS/Linux curl:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer change-me-local-key' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

Windows PowerShell curl:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/chat/completions `
  -Method Post `
  -Headers @{ Authorization = "Bearer change-me-local-key" } `
  -ContentType "application/json" `
  -Body '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

## Config

```json
{
  "listen": { "host": "127.0.0.1", "port": 8787 },
  "requireApiKey": true,
  "localApiKeys": ["change-me-local-key"],
  "strategy": "round-robin",
  "stickyRequests": 3,
  "upstream": {
    "baseUrl": "https://api.openai.com/v1",
    "timeoutMs": 600000
  },
  "accounts": [
    {
      "id": "work-1",
      "apiKeyEnv": "OPENAI_KEY_WORK_1",
      "priority": 1,
      "enabled": true,
      "models": { "allow": ["gpt-5*", "gpt-4.1*"] }
    }
  ]
}
```

Account fields:

- `id`: stable local account id shown in `x-local-router-account`.
- `apiKeyEnv`: environment variable containing the OpenAI API key.
- `apiKey`: inline key, supported but not recommended.
- `priority`: lower number is preferred for `fill-first` and tie-breaking.
- `models.allow`: glob-style allowlist, for example `gpt-5*` or `*`.
- `models.deny`: optional glob-style denylist.

## Privacy And Security

- Default bind address is `127.0.0.1`; keep it local unless you know why you need remote access.
- `requireApiKey` defaults to true; change the example local key before real use.
- Request and response bodies are not stored and not logged unless `privacy.logBodies=true`.
- Use `apiKeyEnv` rather than inline `apiKey` for upstream OpenAI keys.
- `config.json` is ignored by git; run `chmod 600 config.json` on macOS/Linux.

## Health

```bash
curl -H 'Authorization: Bearer change-me-local-key' http://127.0.0.1:8787/health
```

## Test

```bash
npm test
```
