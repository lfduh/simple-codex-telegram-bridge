# simple-codex-telegram-bridge

[English version](./README.md)

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lfduh/simple-codex-telegram-bridge/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/lfduh/simple-codex-telegram-bridge?style=social)](https://github.com/lfduh/simple-codex-telegram-bridge/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/lfduh/simple-codex-telegram-bridge)](https://github.com/lfduh/simple-codex-telegram-bridge/issues)

這是一個讓你用 Telegram 遠端丟任務給 Codex 的極簡 bridge。你在手機上發訊息，Codex 在你的電腦上執行；真正動手前，會先經過你批准。

如果你想要的是一個好裝、好懂、沒有一堆額外抽象層的工具，這個專案就是往這個方向設計的。

## 特色

- 以 chat 為單位保存 thread 歷史，不會每次都從零開始
- `/new` 會沿用目前 thread 的工作目錄
- `/new <absolute-path>` 可以直接開一個綁定新目錄的 thread
- `/threads` 可列出最近 thread，並用 inline button 快速切換
- `/cwd` 可查看目前 active thread 的工作目錄
- `/stop` 可中止當前 Codex turn，但不會把 thread 刪掉

## 系統需求

- Node.js >= 20
- 已安裝並登入 Codex CLI（`codex auth login` 或設好 `OPENAI_API_KEY`）
- 一個 Telegram bot token

## 安裝與設定

### 1. Clone 專案並安裝依賴

```bash
git clone https://github.com/lfduh/simple-codex-telegram-bridge.git
cd simple-codex-telegram-bridge
npm install
```

也可以直接從 GitHub 以全域 CLI 方式安裝：

```bash
npm install -g github:lfduh/simple-codex-telegram-bridge
```

這只會安裝 bridge，本機仍需先安裝並登入 `codex` CLI。

安裝完成後，請先建立一個給 bot 執行的工作目錄，並在該目錄下執行 `codex-tg`。

### 2. 建立 Telegram bot

1. 在 Telegram 中聯絡 [@BotFather](https://t.me/BotFather)
2. 傳送 `/newbot`，照流程建立 bot
3. 如果你打算在群組裡用，記得再執行 `/setprivacy`，把 privacy mode 關掉

### 3. 找到你的 Telegram user ID

在 Telegram 聯絡 [@userinfobot](https://t.me/userinfobot)，它會回傳你的數字 user ID。

### 4. 設定環境變數

```bash
cp .env.example .env
```

打開 `.env` 後，至少填這幾個值：

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_telegram_user_id
WORK_DIR=/optional/default/project/path
```

`WORK_DIR` 是可選的。

- 如果有設定：當還沒有 active thread 時，第一個 thread 會先用這個目錄
- 如果沒設定：bot 還是能啟動，但你要先用 `/new <absolute-path>` 建立第一個可執行的 thread

### 5. 啟動

```bash
npm run dev
npm run build
npm start
```

如果是從 GitHub 全域安裝：

```bash
codex --version
codex auth login
mkdir -p ~/codex-tg
cd ~/codex-tg
curl -L https://raw.githubusercontent.com/lfduh/simple-codex-telegram-bridge/main/.env.example -o .env
# 編輯 .env
codex-tg
```

## 使用方式

### Thread 與工作目錄規則

- 一般訊息會接續目前 active thread
- 每個 thread 建立後都會固定自己的工作目錄
- `/new` 會建立新 thread，並沿用目前 thread 的工作目錄
- `/new <absolute-path>` 會建立一個綁定該目錄的新 thread
- `/switch <thread-id>` 會切換 active thread，並切回該 thread 原本的工作目錄

### 指令列表

- `/start`：顯示說明
- `/status`：顯示 active thread、工作目錄、模型與任務狀態
- `/new`：沿用目前 thread 目錄建立新 thread
- `/new <absolute-path>`：建立綁定指定目錄的新 thread
- `/threads`：列出目前 chat 的最近 thread，並可用 inline button 切換
- `/switch <thread-id>`：切換到目前 chat 的其他 thread
- `/cwd`：查看目前 active thread 的工作目錄
- `/stop`：中止目前正在執行的任務

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | 必填 | 由 @BotFather 取得 |
| `ALLOWED_USER_IDS` | 必填 | 允許操作 bot 的 Telegram user ID，逗號分隔 |
| `WORK_DIR` | 未設定 | 沒有 active thread 時，第一個 thread 可用的預設目錄 |
| `CODEX_MODEL` | `o4-mini` | Codex 使用的模型 |
| `APPROVAL_MODE` | `on-request` | `on-request` 或 `auto` |
| `APPROVAL_TIMEOUT_MS` | `300000` | 批准逾時時間（5 分鐘） |
| `STREAM_DEBOUNCE_MS` | `2000` | Telegram 訊息更新的 debounce 間隔 |
| `STATE_FILE` | `./data/state.json` | 保存本地 thread metadata 的 JSON 檔 |
| `MAX_RECENT_THREADS` | `10` | 每個 chat 保留的最近 thread 數量 |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lfduh/simple-codex-telegram-bridge&type=Date)](https://star-history.com/#lfduh/simple-codex-telegram-bridge&Date)

## 注意事項

- bot 不會再用 `process.cwd()` 當成 Codex 的 fallback 工作目錄
- thread metadata 會保存到 `STATE_FILE`
- 完整對話內容仍保存在 Codex session storage
- 只有 `ALLOWED_USER_IDS` 裡的使用者可以操作 bot

## 授權

MIT
