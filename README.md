# simple-codex-discord-bridge

A minimal Discord bridge for Codex — simple setup, full approval control.

Send a message from your phone. Codex runs on your machine. You approve every task before it touches your code.

```
You (Discord)
    ↓ message
Approval prompt — [✅ Allow] [❌ Deny]
    ↓ approved
Codex SDK (local machine)
    ↓ streams output
Discord (live updates)
```

## Why this exists

Other bridges do too much. This one does one thing: connect Discord to Codex, with a gate in between.

- ~300 lines of TypeScript
- No database, no JSON store, no plugin system
- One approval per task (whole-turn, before execution)
- Streaming output with debounced Discord edits
- Built-in `/stop` to cancel a running task

## Requirements

- Node.js >= 20
- Codex CLI installed and authenticated (`codex auth login` or `OPENAI_API_KEY` set)
- A Discord bot token

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/simple-codex-discord-bridge.git
cd simple-codex-discord-bridge
npm install
```

### 2. Create a Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
2. Bot tab → Reset Token → copy it
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. OAuth2 → URL Generator → scope `bot` → permissions:
   - Send Messages
   - Read Message History
   - View Channels
   - Add Reactions
5. Copy the invite URL and add the bot to your server

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_discord_user_id
WORK_DIR=/path/to/your/project
```

To find your Discord user ID: Settings → Advanced → enable Developer Mode → right-click your name → Copy User ID.

### 4. Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Usage

Send any message to the bot in Discord. You'll get an approval prompt:

```
⏳ Awaiting approval
───────────────────
fix the bug in auth.ts
───────────────────
[✅ Allow]  [❌ Deny]
```

Click Allow — Codex starts running and streams output back to Discord in real time.

To cancel a running task: send `/stop`

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | required | Your Discord bot token |
| `ALLOWED_USER_IDS` | required | Comma-separated Discord user IDs |
| `WORK_DIR` | `process.cwd()` | Directory Codex operates on |
| `CODEX_MODEL` | `o4-mini` | Codex model |
| `APPROVAL_MODE` | `on-request` | `on-request` or `auto` |
| `APPROVAL_TIMEOUT_MS` | `300000` | Approval timeout (5 min) |
| `STREAM_DEBOUNCE_MS` | `1500` | Discord edit debounce interval |

## Running as a background service

### macOS (launchd)

```bash
# Create a plist at ~/Library/LaunchAgents/com.simple-codex-discord-bridge.plist
# then: launchctl load ~/Library/LaunchAgents/com.simple-codex-discord-bridge.plist
```

### Linux (systemd)

```ini
[Unit]
Description=simple-codex-discord-bridge

[Service]
ExecStart=/usr/bin/node /path/to/dist/index.js
WorkingDirectory=/path/to/simple-codex-discord-bridge
EnvironmentFile=/path/to/simple-codex-discord-bridge/.env
Restart=on-failure

[Install]
WantedBy=default.target
```

### Windows

Use Task Scheduler or run in a persistent terminal (Windows Terminal, tmux via WSL).

## Security

- Only users listed in `ALLOWED_USER_IDS` can trigger Codex
- Approval gate requires explicit confirmation before every task
- `.env` contains your tokens — never commit it (it's in `.gitignore`)
- The bridge has no inbound network listeners — it only polls Discord's API

## License

MIT
