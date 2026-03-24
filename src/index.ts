import { Bot, type Context } from 'grammy'
import { config, isAllowedUser } from './config.js'
import { requestApproval } from './approval.js'
import { runCodex } from './codex.js'

// ── Debounced Telegram message edit ───────────────────────────────────────────

function makeDebouncer(flushMs: number) {
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  return function debounce(key: number, fn: () => Promise<void>) {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)
    timers.set(key, setTimeout(async () => {
      timers.delete(key)
      await fn()
    }, flushMs))
  }
}

// ── Message chunking ──────────────────────────────────────────────────────────
// Telegram limit is 4096 chars. Split on newlines where possible.

function splitIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = []
  while (text.length > 0) {
    if (text.length <= maxLen) {
      chunks.push(text)
      break
    }
    const slice = text.slice(0, maxLen)
    const lastNewline = slice.lastIndexOf('\n')
    const cutAt = lastNewline > maxLen / 2 ? lastNewline : maxLen
    chunks.push(text.slice(0, cutAt))
    text = text.slice(cutAt)
  }
  return chunks
}

// ── Escape Markdown special chars for Telegram ────────────────────────────────
// Only needed for plain text outside code blocks.

function escapeMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

// ── Active sessions ───────────────────────────────────────────────────────────

const activeSessions = new Map<number, AbortController>() // key: chatId

// ── Bot setup ─────────────────────────────────────────────────────────────────

const bot = new Bot(config.telegramToken)

bot.command('start', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  await ctx.reply(
    '👋 *Codex Bridge ready*\n\nSend me any task and I\'ll ask for approval before running it.\n\nCommands:\n`/stop` — cancel running task\n`/status` — show bridge info',
    { parse_mode: 'Markdown' },
  )
})

bot.command('status', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat.id
  const running = activeSessions.has(chatId)
  await ctx.reply(
    `*Bridge status*\n📂 Work dir: \`${config.workDir}\`\n🤖 Model: \`${config.model}\`\n⚙️ Task: ${running ? '🟢 running' : '⚪ idle'}`,
    { parse_mode: 'Markdown' },
  )
})

bot.command('stop', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const session = activeSessions.get(ctx.chat.id)
  if (session) {
    session.abort()
    await ctx.reply('⛔ Stopping current task…')
  } else {
    await ctx.reply('No active task in this chat.')
  }
})

bot.on('message:text', async (ctx: Context) => {
  const userId = ctx.from?.id ?? 0
  if (!isAllowedUser(userId)) return

  const chatId = ctx.chat?.id
  if (!chatId) return

  const text = ctx.message?.text?.trim()
  if (!text || text.startsWith('/')) return

  // Reject concurrent tasks
  if (activeSessions.has(chatId)) {
    await ctx.reply('⏳ A task is already running. Send /stop to cancel it first.')
    return
  }

  // ── Approval gate ──────────────────────────────────────────────────────────
  if (config.approvalMode === 'on-request') {
    const approved = await requestApproval(bot, chatId, userId, text)
    if (!approved) return
  }

  // ── Run Codex ──────────────────────────────────────────────────────────────
  const abortController = new AbortController()
  activeSessions.set(chatId, abortController)

  // Send initial status message — we'll edit it as output streams in
  const statusMsg = await ctx.reply('⏳ Codex is working…')
  const extraMsgIds: number[] = []
  const debounce = makeDebouncer(config.streamDebounceMs)

  const flushToTelegram = async (text: string) => {
    // Wrap in code block for readability, escape nothing (code block is safe)
    const formatted = '```\n' + text + '\n```'
    const chunks = splitIntoChunks(formatted, config.maxMessageLength)

    // Edit the first (status) message
    try {
      await bot.api.editMessageText(chatId, statusMsg.message_id, chunks[0], {
        parse_mode: 'Markdown',
      })
    } catch {
      // Message unchanged — Telegram throws if content is identical, ignore
    }

    // Send/edit overflow messages
    for (let i = 1; i < chunks.length; i++) {
      if (i - 1 < extraMsgIds.length) {
        try {
          await bot.api.editMessageText(chatId, extraMsgIds[i - 1], chunks[i], {
            parse_mode: 'Markdown',
          })
        } catch { /* unchanged */ }
      } else {
        const m = await bot.api.sendMessage(chatId, chunks[i], {
          parse_mode: 'Markdown',
        })
        extraMsgIds.push(m.message_id)
      }
    }
  }

  await runCodex(
    text,

    // onChunk — debounced live update
    (output) => {
      debounce(chatId, () => flushToTelegram(output))
    },

    // onDone — final flush
    async (output) => {
      activeSessions.delete(chatId)
      await flushToTelegram((output || '*(no output)*') + '\n\n✅ Done')
    },

    // onError
    async (err) => {
      activeSessions.delete(chatId)
      console.error('Codex error:', err)
      await bot.api.editMessageText(
        chatId,
        statusMsg.message_id,
        `❌ *Error:* ${escapeMd(err.message)}`,
        { parse_mode: 'MarkdownV2' },
      )
    },

    abortController.signal,
  )
})

// ── Start ─────────────────────────────────────────────────────────────────────

console.log(`✅ Codex Telegram Bridge starting…`)
console.log(`📂 Work dir: ${config.workDir}`)
console.log(`👤 Allowed users: ${config.allowedUserIds.join(', ') || '(none — set ALLOWED_USER_IDS)'}`)

bot.start({
  onStart: (info) => console.log(`🤖 Bot ready: @${info.username}`),
}).catch(err => {
  console.error('Failed to start bot:', err.message)
  process.exit(1)
})
