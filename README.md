# simple-codex-telegram-bridge

A minimal Telegram bridge for Codex — simple setup, full approval control.

Send a task from your phone. Codex runs on your machine. You approve before it touches your code.

```
You (Telegram)
    ↓ message
Approval prompt — [✅ Allow] [❌ Deny]
    ↓ approved
Codex SDK (local machine)
    ↓ streams output
Telegram (live updates)
```

## Why Telegram over Discord

- 4096 char limit vs Discord's 2000 — Codex output fits in fewer messages
- Simpler bot API — less rate limiting friction for streaming
- Inline keyboards feel more natural on mobile

## Why this exists

Other bridges do too much. This one does one thing: connect Telegram to Codex, with a gate in between.

- ~300 lines of TypeScript across 4 files
- No database, no JSON store, no plugin system
- One approval per task (whole-turn, before execution)
- Streaming output with debounced Telegram edits
- Built-in `/stop` to cancel a running task

## Requirements

- Node.js >= 20
- Codex CLI installed and authenticated (`codex auth login` or `OPENAI_API_KEY` set)
- A Telegram bot token

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/simple-codex-telegram-bridge.git
cd simple-codex-telegram-bridge
npm install
```

### 2. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` → follow the prompts → copy the token
3. Send `/setprivacy` → select your bot → `Disable` (needed if using in groups)

### 3. Find your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram — it replies with your numeric user ID.

### 4. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_telegram_user_id
WORK_DIR=/path/to/your/project
```

### 5. Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Usage

Send any message to your bot. You'll get an approval prompt:

```
⏳ Awaiting approval
───────────────────
fix the bug in auth.ts
───────────────────
[✅ Allow]  [❌ Deny]
```

Tap Allow — Codex starts and streams output back in real time.

Commands:
- `/stop` — cancel the running task
- `/status` — show work dir, model, and task state
- `/start` — show help

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | From @BotFather |
| `ALLOWED_USER_IDS` | required | Comma-separated Telegram user IDs |
| `WORK_DIR` | `process.cwd()` | Directory Codex operates on |
| `CODEX_MODEL` | `o4-mini` | Codex model |
| `APPROVAL_MODE` | `on-request` | `on-request` or `auto` |
| `APPROVAL_TIMEOUT_MS` | `300000` | Approval timeout (5 min) |
| `STREAM_DEBOUNCE_MS` | `2000` | Telegram edit debounce interval |

## Running as a background service

### macOS (launchd)

Create `~/Library/LaunchAgents/com.simple-codex-tg-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.simple-codex-tg-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/simple-codex-telegram-bridge/dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TELEGRAM_BOT_TOKEN</key>
    <string>your_token</string>
    <key>ALLOWED_USER_IDS</key>
    <string>your_id</string>
    <key>WORK_DIR</key>
    <string>/path/to/project</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.simple-codex-tg-bridge.plist
```

### Linux (systemd)

```ini
[Unit]
Description=simple-codex-telegram-bridge

[Service]
ExecStart=/usr/bin/node /path/to/dist/index.js
WorkingDirectory=/path/to/simple-codex-telegram-bridge
EnvironmentFile=/path/to/simple-codex-telegram-bridge/.env
Restart=on-failure

[Install]
WantedBy=default.target
```

## Security

- Only users listed in `ALLOWED_USER_IDS` can trigger Codex
- Approval gate requires explicit confirmation before every task
- `.env` contains your tokens — never commit it (it's in `.gitignore`)
- The bridge has no inbound network listeners

## License

MIT
