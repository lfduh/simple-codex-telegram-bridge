# simple-codex-telegram-bridge

[English version](./README.md)

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/lfduh/simple-codex-telegram-bridge/blob/main/LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/lfduh/simple-codex-telegram-bridge?style=social)](https://github.com/lfduh/simple-codex-telegram-bridge/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/lfduh/simple-codex-telegram-bridge)](https://github.com/lfduh/simple-codex-telegram-bridge/issues)

這是一個讓你用 Telegram 遠端與 Codex 對話的極簡 bridge。你在手機上發訊息，Codex 在你的電腦上執行；一般討論會先走討論模式，真的要執行時也可以明確切到任務模式。

如果你想要的是一個好裝、好懂、沒有一堆額外抽象層的工具，這個專案就是往這個方向設計的。

## 特色

- 以 chat 為單位保存 thread 歷史，不會每次都從零開始
- 每個 thread 建立後都會固定自己的工作目錄
- 可直接在 Telegram 中建立或切換 thread
- 最近 thread 可用 inline button 快速切換
- 可中止當前 Codex turn，但不會把 thread 刪掉
- 一般訊息會自動分流成討論或任務
- 可用 `/run` 明確強制送出可執行任務

## 系統需求

- Node.js >= 20
- 已安裝並登入 Codex CLI（`codex auth login` 或設好 `OPENAI_API_KEY`）
- 一個 Telegram bot token

## 安裝與設定

### 1. 安裝

正式版本建議直接從 GitHub Releases 安裝 `.tgz` 套件：

```bash
npm install -g https://github.com/lfduh/simple-codex-telegram-bridge/releases/download/v0.1.5/simple-codex-telegram-bridge-0.1.5.tgz
```

這會直接安裝已打包好的 CLI，本機仍需先安裝並登入 `codex` CLI。

如果是本機開發，請 clone 專案後用 `npm link`：

```bash
git clone https://github.com/lfduh/simple-codex-telegram-bridge.git
cd simple-codex-telegram-bridge
npm install
npm link
```

### 2. 建立 Telegram bot

1. 在 Telegram 中聯絡 [@BotFather](https://t.me/BotFather)
2. 傳送 `/newbot`，照流程建立 bot
3. 如果你打算在群組裡用，記得再執行 `/setprivacy`，把 privacy mode 關掉

### 3. 找到你的 Telegram user ID

在 Telegram 聯絡 [@userinfobot](https://t.me/userinfobot)，它會回傳你的數字 user ID。

### 4. 設定環境變數

bridge 會從使用者層級的 env 檔讀設定：

- macOS/Linux：`~/.codex-tg/.env`
- Windows：`%USERPROFILE%\.codex-tg\.env`

可先用這個指令初始化預設設定檔：

```bash
codex-tg init
```

或手動建立：

```bash
mkdir -p ~/.codex-tg
cp .env.example ~/.codex-tg/.env
```

`.env` 至少填這幾個值：

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
ALLOWED_USER_IDS=your_telegram_user_id
WORK_DIR=/Users/yourname/Projects
```

`WORK_DIR` 是可選的。

- 如果有設定：當還沒有 active thread 時，第一個 thread 會先用這個目錄
- 如果沒設定：bot 還是能啟動，也能先處理純討論訊息；但要動到檔案前，仍需先用 `/new <absolute-path>` 建立第一個可執行的 thread

進階覆蓋方式：

- `CODEX_TG_HOME`：覆蓋預設設定目錄
- `CODEX_TG_ENV_FILE`：覆蓋 env 檔位置
- `STATE_FILE`：覆蓋本地 state 檔路徑

### 5. 啟動

```bash
npm run dev
npm run build
npm start
```

如果是從 GitHub Release asset 安裝：

```bash
codex --version
codex auth login
codex-tg init
# 編輯 ~/.codex-tg/.env
codex-tg
```

## 使用方式

### Thread 與工作目錄規則

- 一般訊息會接續目前 active thread
- bot 會先判斷訊息較像討論還是可執行任務
- 討論模式只回覆分析與建議，不會主動執行命令或修改檔案
- 每個 thread 建立後都會固定自己的工作目錄；切換 thread 時，也會一併切回該 thread 原本綁定的目錄

### 指令列表

- `/start`：顯示說明
- `codex-tg init`：在 `~/.codex-tg/.env` 建立預設設定範本
- `/run <task>`：在目前 active thread 中明確執行任務
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
| `CODEX_MODEL` | `gpt-5.1-codex-mini` | Codex 使用的模型；適用於用 `codex auth login` 登入 ChatGPT 帳號的情境 |
| `APPROVAL_MODE` | `auto` | `auto` 或 `on-request`；只有可執行任務才會跳 Telegram 批准 |
| `APPROVAL_TIMEOUT_MS` | `300000` | 批准逾時時間（5 分鐘） |
| `STREAM_DEBOUNCE_MS` | `2000` | Telegram 訊息更新的 debounce 間隔 |
| `STATE_FILE` | `~/.codex-tg/data/state.json` | 保存本地 thread metadata 的 JSON 檔 |
| `MAX_RECENT_THREADS` | `10` | 每個 chat 保留的最近 thread 數量 |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lfduh/simple-codex-telegram-bridge&type=Date)](https://star-history.com/#lfduh/simple-codex-telegram-bridge&Date)

## 注意事項

- bot 不會再用 `process.cwd()` 當成 Codex 的 fallback 工作目錄
- thread metadata 預設會保存在設定目錄下的 `STATE_FILE`
- 完整對話內容仍保存在 Codex session storage
- 只有 `ALLOWED_USER_IDS` 裡的使用者可以操作 bot

## 授權

MIT





