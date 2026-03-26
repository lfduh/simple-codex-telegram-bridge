# simple-codex-telegram-bridge

[繁體中文版本](./README.zh-TW.md)

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lfduh/simple-codex-telegram-bridge/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/lfduh/simple-codex-telegram-bridge?style=social)](https://github.com/lfduh/simple-codex-telegram-bridge/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/lfduh/simple-codex-telegram-bridge)](https://github.com/lfduh/simple-codex-telegram-bridge/issues)

A minimal Telegram bridge for Codex with explicit approval and persistent threads.

Send a task from your phone. Codex runs on your machine. You approve before it touches your code.

## Highlights

- Persistent per-chat thread history
- Each thread keeps its own working directory after creation
- Create or switch threads directly from Telegram
- Recent threads can be switched with inline buttons
- Stop the current Codex turn without deleting the thread

## Requirements

- Node.js >= 20
- Codex CLI installed and authenticated (`codex auth login` or `OPENAI_API_KEY` set)
- A Telegram bot token

## Setup

### 1. Install

For released versions, install the package tarball from GitHub Releases:

```bash
npm install -g https://github.com/lfduh/simple-codex-telegram-bridge/releases/download/v0.1.2/simple-codex-telegram-bridge-0.1.2.tgz
```

This installs the prebuilt CLI package. You still need the `codex` CLI installed and authenticated on the same machine.

For local development, clone the repo and use `npm link`:

```bash
git clone https://github.com/lfduh/simple-codex-telegram-bridge.git
cd simple-codex-telegram-bridge
npm install
npm link
```

### 2. Create a Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Send `/setprivacy` and disable privacy if you want to use the bot in groups

### 3. Find your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram to get your numeric user ID.

### 4. Configure

The bridge reads its config from a user-level env file:

- macOS/Linux: `~/.codex-tg/.env`
- Windows: `%USERPROFILE%\.codex-tg\.env`

Initialize the default config file with:

```bash
codex-tg init
```

Or create it manually:

```bash
mkdir -p ~/.codex-tg
cp .env.example ~/.codex-tg/.env
```

Example `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_telegram_user_id
WORK_DIR=/Users/yourname/Projects
```

`WORK_DIR` is optional. If it is unset, the bot will still start, but you must create the first runnable thread with `/new <absolute-path>`.

Advanced overrides:

- `CODEX_TG_HOME` overrides the config directory
- `CODEX_TG_ENV_FILE` overrides the env file path
- `STATE_FILE` overrides the local state file path
### 5. Run

```bash
npm run dev
npm run build
npm start
```

If installed from a GitHub Release asset:

```bash
codex --version
codex auth login
codex-tg init
# edit ~/.codex-tg/.env
codex-tg
```

## Usage

### Thread model

- Normal messages continue the active thread.
- Each thread keeps its own working directory after creation, and switching threads restores that thread's directory.

### Commands

- `/start` — show help
- `codex-tg init` — create the default config template at `~/.codex-tg/.env`
- `/status` — show active thread, directory, model, and task state
- `/new` — create a new thread using the current thread directory
- `/new <absolute-path>` — create a new thread bound to a specific directory
- `/threads` — list recent threads for the current chat and switch with inline buttons
- `/switch <thread-id>` — switch to another thread from the current chat
- `/cwd` — show the active thread directory
- `/stop` — cancel the running task

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | From @BotFather |
| `ALLOWED_USER_IDS` | required | Comma-separated Telegram user IDs |
| `WORK_DIR` | unset | Default directory for the first thread when no active thread exists |
| `CODEX_MODEL` | `o4-mini` | Codex model |
| `APPROVAL_MODE` | `on-request` | `on-request` or `auto` |
| `APPROVAL_TIMEOUT_MS` | `300000` | Approval timeout (5 min) |
| `STREAM_DEBOUNCE_MS` | `2000` | Telegram edit debounce interval |
| `STATE_FILE` | `~/.codex-tg/data/state.json` | Local JSON file for thread metadata |
| `MAX_RECENT_THREADS` | `10` | Number of recent threads kept per chat |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lfduh/simple-codex-telegram-bridge&type=Date)](https://star-history.com/#lfduh/simple-codex-telegram-bridge&Date)

## Notes

- The bot never falls back to `process.cwd()` for Codex work.
- Thread metadata is stored locally in `STATE_FILE` under the config directory by default.
- Full conversation history stays in Codex session storage.
- Only users listed in `ALLOWED_USER_IDS` can use the bot.

## License

MIT



