# local-router

Local OpenAI-compatible router. README nay chi huong dan init va OAuth login.

## Init

Yeu cau Node.js 20+.

```bash
git clone https://github.com/linhvo229/local-router.git
cd local-router
node src/cli.js init
```

`init` tao `config.json` tu `config.example.json` va sinh local API key. Lenh nay khong ghi de config hien co, tru khi dung `--force`.

## OAuth Login

Dang nhap Codex OAuth account:

```bash
node src/cli.js codex login --id codex-1
```

Neu da link/install CLI global, co the dung `local-router` thay cho `node src/cli.js`:

```bash
local-router init
local-router codex login --id codex-1
```
