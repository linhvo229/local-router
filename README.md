# local-router

A small local OpenAI account router with safe defaults. It exposes an OpenAI-compatible local endpoint and routes requests across multiple OpenAI API keys/accounts.

## Quick Start

```bash
git clone https://github.com/linhvo229/local-router.git
cd local-router
node src/cli.js init
```

Edit `config.json`, replace `PASTE_OPENAI_API_KEY_HERE` with your OpenAI API key, then start:

```bash
npm start
```

Use this in OpenAI-compatible clients:

```text
Base URL: http://127.0.0.1:8787/v1
API key:  the local key in config.json
```

Test with curl:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer local-...from-config...' \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'
```

## Goals

- Route `/v1/chat/completions`, `/v1/responses`, and `/v1/models` to OpenAI.
- Switch between multiple OpenAI accounts with `round-robin` or `fill-first`.
- Fallback to another account on `429`, `401`, `403`, `5xx`, or network errors.
- Bind to localhost by default and require a local API key.
- Avoid logging request/response bodies by default.

## CLI

```bash
node src/cli.js init
node src/cli.js account list
node src/cli.js account add --id openai-2 --name "OpenAI 2" --key sk-...
node src/cli.js account add --id work --env OPENAI_API_KEY
node src/cli.js start
```

If installed globally or linked with npm, use `local-router` instead of `node src/cli.js`.

`init` creates `config.json` from `config.example.json` and generates a random local API key. It will not overwrite an existing config unless you pass `--force`.

## Setup On macOS/Linux

```bash
git clone https://github.com/linhvo229/local-router.git
cd local-router
node src/cli.js init
chmod 600 config.json
```

Edit `config.json`, replace `PASTE_OPENAI_API_KEY_HERE` with your OpenAI API key, then start:

```bash
npm start
```

## Setup On Windows

Install Node.js 20+ first: https://nodejs.org

PowerShell:

```powershell
git clone https://github.com/linhvo229/local-router.git
cd local-router
node src/cli.js init
notepad config.json
npm start
```

## Config

VS Code can use `config.schema.json` for autocomplete/validation. The default config looks like:

```json
{
  "listen": { "host": "127.0.0.1", "port": 8787 },
  "requireApiKey": true,
  "localApiKeys": ["local-router-key-change-me"],
  "strategy": "round-robin",
  "stickyRequests": 3,
  "maxBodyBytes": 26214400,
  "upstream": {
    "baseUrl": "https://api.openai.com/v1",
    "timeoutMs": 600000
  },
  "accounts": [
    {
      "id": "openai-1",
      "name": "OpenAI Account 1",
      "apiKey": "PASTE_OPENAI_API_KEY_HERE",
      "priority": 1,
      "enabled": true,
      "models": { "allow": ["*"] }
    }
  ]
}
```

Account fields:

- `id`: stable local account id shown in `x-local-router-account`.
- `apiKey`: inline OpenAI API key. Convenient, but keep `config.json` private.
- `apiKeyEnv`: environment variable containing the OpenAI API key, if you prefer not to store the key in JSON.
- `priority`: lower number is preferred for `fill-first` and tie-breaking.
- `models.allow`: glob-style allowlist, for example `gpt-5*` or `*`.
- `models.deny`: optional glob-style denylist.

## Privacy And Security

- Default bind address is `127.0.0.1`; keep it local unless you know why you need remote access.
- `requireApiKey` defaults to true; change the example local key before real use.
- Request and response bodies are not stored and not logged unless `privacy.logBodies=true`.
- Use `apiKeyEnv` rather than inline `apiKey` for upstream OpenAI keys if you want stronger local hygiene.
- `config.json` is ignored by git; run `chmod 600 config.json` on macOS/Linux.

## Health

```bash
curl -H 'Authorization: Bearer local-...from-config...' http://127.0.0.1:8787/health
```

## Test

```bash
npm test
```
