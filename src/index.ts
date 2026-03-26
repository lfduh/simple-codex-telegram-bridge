#!/usr/bin/env node
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { defaultConfigDir, envFilePath } from './paths.js'

const cliArgs = new Set(process.argv.slice(2))

if (cliArgs.has('--help') || cliArgs.has('-h')) {
  console.log([
    'simple-codex-telegram-bridge',
    '',
    'Usage:',
    '  codex-tg',
    '  codex-tg --help',
    '  codex-tg --version',
    '  codex-tg init',
    '',
    'Environment:',
    '  TELEGRAM_BOT_TOKEN  Telegram bot token from @BotFather',
    '  ALLOWED_USER_IDS    Comma-separated Telegram user IDs',
    '  WORK_DIR            Optional default project path for the first thread',
    '  CODEX_TG_HOME       Optional override for the config directory',
    '  CODEX_TG_ENV_FILE   Optional override for the env file path',
    '',
    'Default config locations:',
    `  Config dir: ${defaultConfigDir}`,
    `  Env file:   ${envFilePath}`,
  ].join('\n'))
  process.exit(0)
}

if (cliArgs.has('--version') || cliArgs.has('-V')) {
  const packageJsonUrl = new URL('../package.json', import.meta.url)
  const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as { version?: string }
  console.log(packageJson.version ?? '0.0.0')
  process.exit(0)
}

const envExamplePath = new URL('../.env.example', import.meta.url)

async function ensureEnvFileExists(): Promise<boolean> {
  try {
    await access(envFilePath, constants.F_OK)
    return false
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code !== 'ENOENT') throw err
  }

  await mkdir(path.dirname(envFilePath), { recursive: true })
  await copyFile(envExamplePath, envFilePath)
  return true
}

if (cliArgs.has('init')) {
  const created = await ensureEnvFileExists()
  if (created) {
    console.log(`Created config template at ${envFilePath}`)
    console.log('Edit the file, then run codex-tg again.')
  } else {
    console.log(`Config file already exists at ${envFilePath}`)
  }
  process.exit(0)
}

const createdEnvFile = await ensureEnvFileExists()
if (createdEnvFile) {
  console.error(`Created config template at ${envFilePath}`)
  console.error('Edit the file, then run codex-tg again.')
  process.exit(1)
}

const { Bot, InlineKeyboard } = await import('grammy')
const { registerApprovalHandlers, requestApproval } = await import('./approval.js')
const { config, isAllowedUser } = await import('./config.js')
const { runCodex } = await import('./codex.js')
const { StateStore, createDraftThread, summarizePrompt } = await import('./state.js')
type Context = import('grammy').Context
type ThreadSummary = import('./state.js').ThreadSummary
type MessageIntent = 'discussion' | 'task'

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

function wrapCodeChunk(text: string): string {
  return `\`\`\`\n${text.replace(/```/g, '``\\`')}\n\`\`\``
}

function formatOutputChunks(text: string, maxLen: number): string[] {
  const fallback = text || '(no output)'
  const chunks: string[] = []
  let remaining = fallback

  while (remaining.length > 0) {
    let candidateSize = Math.min(remaining.length, maxLen)

    while (candidateSize > 0) {
      const slice = remaining.slice(0, candidateSize)
      const lastNewline = slice.lastIndexOf('\n')
      const cutAt = lastNewline > candidateSize / 2 ? lastNewline : candidateSize
      const rawChunk = remaining.slice(0, cutAt)
      const wrapped = wrapCodeChunk(rawChunk)
      if (wrapped.length <= maxLen) {
        chunks.push(wrapped)
        remaining = remaining.slice(cutAt)
        break
      }
      candidateSize = cutAt - 1
    }

    if (candidateSize <= 0) {
      const singleChar = remaining[0]
      chunks.push(wrapCodeChunk(singleChar))
      remaining = remaining.slice(1)
    }
  }

  return chunks.length > 0 ? chunks : [wrapCodeChunk('(no output)')]
}

function escapeMdV2(text: string): string {
  return text.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

function escapeMd(text: string): string {
  return text.replace(/[_*\[\]()`]/g, '\\$&')
}

function shortThreadId(threadId: string): string {
  if (threadId.startsWith('draft-')) return threadId.slice(0, 18)
  return threadId.slice(0, 8)
}

function classifyMessageIntent(text: string): MessageIntent {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return 'discussion'

  const taskPatterns = [
    /^\/run\b/,
    /^(幫我|請|麻煩你|協助我|實作|修改|新增|建立|修正|檢查|review|debug|fix|implement|add|update|change|refactor|analyze|inspect)/i,
    /\b(幫我|修改|新增|建立|修正|實作|重構|檢查|分析|review|debug|fix|implement|refactor)\b/i,
  ]

  if (taskPatterns.some(pattern => pattern.test(normalized))) {
    return 'task'
  }

  return 'discussion'
}

function preparePrompt(text: string, intent: MessageIntent): string {
  if (intent === 'discussion') {
    return [
      '請用討論模式回覆這則訊息。',
      '不要執行命令，不要修改檔案，不要使用任何工具。',
      '只提供分析、建議、澄清問題與下一步建議；如果真的需要動手操作，先說明原因並等待使用者明確要求。',
      '',
      text,
    ].join('\n')
  }

  return text
}

function describeThread(thread: ThreadSummary): string {
  const safeTitle = escapeMd(thread.title)
  const safeWorkDir = escapeMd(thread.workDir ?? '(unset)')
  return `• ${safeTitle} [${shortThreadId(thread.id)}]\n  ${safeWorkDir}`
}

async function validateWorkDir(input: string): Promise<string> {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Usage: /new <absolute-path>')
  if (!path.isAbsolute(trimmed)) throw new Error('Work dir must be an absolute path.')

  const normalized = path.normalize(trimmed)
  const info = await stat(normalized)
  if (!info.isDirectory()) throw new Error('Work dir must point to a directory.')
  await access(normalized, constants.R_OK)
  return normalized
}

function findThreadByInput(chatId: number, input: string): { thread: ThreadSummary | null, ambiguous: boolean } {
  const threads = store.listThreads(chatId)
  const exact = threads.find(entry => entry.id === input)
  if (exact) return { thread: exact, ambiguous: false }

  const matches = threads.filter(entry => entry.id.startsWith(input))
  if (matches.length === 1) return { thread: matches[0], ambiguous: false }
  if (matches.length > 1) return { thread: null, ambiguous: true }
  return { thread: null, ambiguous: false }
}

async function resolveFallbackWorkDir(chatId: number): Promise<string | null> {
  const currentWorkDir = getCurrentThread(chatId)?.workDir
  if (currentWorkDir) return currentWorkDir
  if (!config.initialWorkDir) return null
  return validateWorkDir(config.initialWorkDir)
}
const runningTasks = new Map<number, AbortController>()
const pendingApprovals = new Set<number>()
const bot = new Bot(config.telegramToken)
const store = new StateStore(config.stateFile, config.maxRecentThreads)
await store.load()
registerApprovalHandlers(bot)

async function syncThreadState(chatId: number, previousThread: ThreadSummary, nextThreadId: string, title: string): Promise<void> {
  const now = new Date().toISOString()
  const nextThread: ThreadSummary = {
    ...previousThread,
    id: nextThreadId,
    title,
    lastUsedAt: now,
  }

  if (previousThread.id !== nextThreadId) {
    await store.replaceThreadId(previousThread.id, nextThread)
  } else {
    await store.updateThread(nextThreadId, {
      title,
      lastUsedAt: now,
    })
  }

  await store.setCurrentThread(chatId, nextThreadId)
}

function getCurrentThread(chatId: number): ThreadSummary | null {
  const chat = store.getChat(chatId)
  return store.getThread(chat.currentThreadId)
}

function isBusy(chatId: number): boolean {
  return pendingApprovals.has(chatId) || runningTasks.has(chatId)
}

async function sendBusyMessage(ctx: Context, chatId: number): Promise<void> {
  if (runningTasks.has(chatId)) {
    await ctx.reply('⏳ A task is already running. Send /stop to cancel it first.')
  } else {
    await ctx.reply('⏳ Approval is pending for the current task. Respond to it or wait for timeout.')
  }
}

async function ensureThreadForIntent(ctx: Context, chatId: number, intent: MessageIntent): Promise<ThreadSummary | null> {
  let activeThread = getCurrentThread(chatId)
  if (!activeThread) {
    let workDir: string | null = null

    if (config.initialWorkDir) {
      workDir = await validateWorkDir(config.initialWorkDir).catch(() => null)
      if (!workDir && intent === 'task') {
        await ctx.reply(`Configured WORK_DIR is invalid. Use /new <absolute-path> first or fix ${envFilePath}.`)
        return null
      }
    } else if (intent === 'task') {
      await ctx.reply('No active thread or default work dir. Use /new <absolute-path> first.')
      return null
    }

    activeThread = createDraftThread(workDir)
    await store.createThread(chatId, activeThread)
    await store.setCurrentThread(chatId, activeThread.id)
  }

  if (intent === 'task' && !activeThread.workDir) {
    await ctx.reply('This thread has no work dir. Use /new <absolute-path> to create a runnable thread.')
    return null
  }

  return activeThread
}

async function executePrompt(
  ctx: Context,
  text: string,
  intent: MessageIntent,
  approvalPreview = text,
): Promise<void> {
  const userId = ctx.from?.id ?? 0
  const chatId = ctx.chat?.id
  if (!chatId) return

  if (isBusy(chatId)) {
    await sendBusyMessage(ctx, chatId)
    return
  }

  const activeThread = await ensureThreadForIntent(ctx, chatId, intent)
  if (!activeThread) return

  if (intent === 'task' && config.approvalMode === 'on-request') {
    pendingApprovals.add(chatId)
    try {
      const approved = await requestApproval(bot, chatId, userId, approvalPreview)
      if (!approved) return
    } finally {
      pendingApprovals.delete(chatId)
    }
  }

  const abortController = new AbortController()
  runningTasks.set(chatId, abortController)

  const statusLabel = intent === 'discussion' ? '💬 Codex is replying…' : '⏳ Codex is working…'
  const statusMsg = await ctx.reply(statusLabel).catch(() => null)
  if (!statusMsg) {
    runningTasks.delete(chatId)
    return
  }

  const extraMsgIds: number[] = []
  const debounce = makeDebouncer(config.streamDebounceMs)

  const flushToTelegram = async (output: string) => {
    const chunks = formatOutputChunks(output, config.maxMessageLength)
    try {
      await bot.api.editMessageText(chatId, statusMsg.message_id, chunks[0], {
        parse_mode: 'Markdown',
      })
    } catch {
      // ignore identical content or transient edit failures
    }

    for (let i = 1; i < chunks.length; i++) {
      if (i - 1 < extraMsgIds.length) {
        try {
          await bot.api.editMessageText(chatId, extraMsgIds[i - 1], chunks[i], {
            parse_mode: 'Markdown',
          })
        } catch {
          // ignore identical content or transient edit failures
        }
      } else {
        const msg = await bot.api.sendMessage(chatId, chunks[i], {
          parse_mode: 'Markdown',
        })
        extraMsgIds.push(msg.message_id)
      }
    }

    while (extraMsgIds.length > chunks.length - 1) {
      const staleId = extraMsgIds.pop()
      if (staleId) {
        await bot.api.deleteMessage(chatId, staleId).catch(() => undefined)
      }
    }
  }

  try {
    await runCodex({
      prompt: preparePrompt(text, intent),
      workDir: activeThread.workDir,
      model: config.model,
      threadId: activeThread.id.startsWith('draft-') ? undefined : activeThread.id,
      signal: abortController.signal,
      onChunk: async (output) => {
        debounce(chatId, async () => {
          if (!runningTasks.has(chatId)) return
          await flushToTelegram(output)
        })
      },
      onDone: async ({ fullText, threadId }) => {
        runningTasks.delete(chatId)
        const title = summarizePrompt(text)
        await syncThreadState(chatId, activeThread, threadId, title)
        await flushToTelegram(fullText + '\n\nDone')
      },
      onError: async (err) => {
        runningTasks.delete(chatId)
        console.error('Codex error:', err)
        while (extraMsgIds.length > 0) {
          const staleId = extraMsgIds.pop()
          if (staleId) {
            await bot.api.deleteMessage(chatId, staleId).catch(() => undefined)
          }
        }
        await bot.api.editMessageText(
          chatId,
          statusMsg.message_id,
          `❌ *Error:* ${escapeMdV2(err.message)}`,
          { parse_mode: 'MarkdownV2' },
        )
      },
    })
  } catch (err) {
    runningTasks.delete(chatId)
    console.error('Codex error:', err)
    await bot.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ *Error:* ${escapeMdV2(err instanceof Error ? err.message : String(err))}`,
      { parse_mode: 'MarkdownV2' },
    )
  }
}

bot.command('start', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  await ctx.reply(
    '👋 *Codex Bridge ready*\n\n' +
    'Commands:\n' +
    '`/new` — new thread using the current thread directory\n' +
    '`/new <absolute-path>` — new thread bound to a specific directory\n' +
    '`/run <prompt>` — force a runnable Codex task\n' +
    '`/threads` — list recent threads\n' +
    '`/switch <thread-id>` — switch the active thread\n' +
    '`/cwd` — show the active thread directory\n' +
    '`/status` — show bridge info\n' +
    '`/stop` — cancel the running task',
    { parse_mode: 'Markdown' },
  )
})

bot.command('status', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat.id
  const thread = getCurrentThread(chatId)
  const workDir = thread?.workDir ?? '(unset)'
  const taskState = runningTasks.has(chatId)
    ? 'running'
    : pendingApprovals.has(chatId)
      ? 'awaiting approval'
      : 'idle'

  await ctx.reply(
    `*Bridge status*\n` +
    `🧵 Active thread: \`${thread?.id ?? '(none)'}\`\n` +
    `📂 Work dir: \`${workDir}\`\n` +
    `🤖 Model: \`${config.model}\`\n` +
    `🧠 Routing: \`discussion|task\`\n` +
    `✅ Approval: \`${config.approvalMode}\`\n` +
    `⚙️ Task: ${taskState}`,
    { parse_mode: 'Markdown' },
  )
})

bot.command('cwd', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const thread = getCurrentThread(ctx.chat.id)
  if (!thread) {
    await ctx.reply('No active thread. Use /new or /new <absolute-path> first.')
    return
  }

  await ctx.reply(`Current thread directory:\n\`${thread.workDir ?? '(unset)'}\``, {
    parse_mode: 'Markdown',
  })
})

bot.command('stop', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const session = runningTasks.get(ctx.chat.id)
  if (session) {
    session.abort()
    await ctx.reply('⛔ Stopping current task…')
  } else {
    await ctx.reply('No active task in this chat.')
  }
})

bot.command('threads', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat.id
  const threads = store.listThreads(chatId)
  if (threads.length === 0) {
    await ctx.reply('No threads yet. Use /new or send a message to start one.')
    return
  }

  const keyboard = new InlineKeyboard()
  for (const thread of threads) {
    keyboard.text(`${thread.title} [${shortThreadId(thread.id)}]`, `switch:${thread.id}`).row()
  }

  const currentThreadId = store.getChat(chatId).currentThreadId
  const text = '*Recent threads*\n\n' + threads
    .map(thread => `${thread.id === currentThreadId ? '→ ' : ''}${describeThread(thread)}`)
    .join('\n\n')

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  })
})

bot.command('switch', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat.id
  if (isBusy(chatId)) {
    await sendBusyMessage(ctx, chatId)
    return
  }

  const threadId = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (!threadId) {
    await ctx.reply('Usage: /switch <thread-id>')
    return
  }

  const { thread, ambiguous } = findThreadByInput(chatId, threadId)
  if (ambiguous) {
    await ctx.reply('Thread id is ambiguous. Please use a longer id.')
    return
  }
  if (!thread) {
    await ctx.reply('Thread not found in this chat.')
    return
  }

  await store.setCurrentThread(chatId, thread.id)
  await ctx.reply(
    `Switched to:\n\`${thread.id}\`\n\nDirectory:\n\`${thread.workDir ?? '(unset)'}\``,
    { parse_mode: 'Markdown' },
  )
})

bot.command('new', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat.id
  if (isBusy(chatId)) {
    await sendBusyMessage(ctx, chatId)
    return
  }

  const arg = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  let workDir: string | null

  try {
    if (arg) {
      workDir = await validateWorkDir(arg)
    } else {
      workDir = await resolveFallbackWorkDir(chatId)
    }
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : String(err))
    return
  }

  const thread = createDraftThread(workDir)
  await store.createThread(chatId, thread)
  await store.setCurrentThread(chatId, thread.id)

  await ctx.reply(
    `Started a new thread.\n\nThread: \`${thread.id}\`\nDirectory: \`${thread.workDir ?? '(unset)'}\``,
    { parse_mode: 'Markdown' },
  )
})

bot.command('run', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return

  const text = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (!text) {
    await ctx.reply('Usage: /run <task>')
    return
  }

  await executePrompt(ctx, text, 'task', text)
})

bot.callbackQuery(/^switch:/, async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  const chatId = ctx.chat?.id ?? ctx.callbackQuery.message?.chat.id
  if (!chatId) return
  if (isBusy(chatId)) {
    await ctx.answerCallbackQuery({ text: 'Stop or resolve the current task first.' })
    return
  }

  const threadId = ctx.callbackQuery.data.slice('switch:'.length)
  const thread = store.listThreads(chatId).find(entry => entry.id === threadId)
  if (!thread) {
    await ctx.answerCallbackQuery({ text: 'Thread not found.' })
    return
  }

  await store.setCurrentThread(chatId, thread.id)
  await ctx.answerCallbackQuery({ text: `Switched to ${shortThreadId(thread.id)}` })
  await ctx.reply(
    `Switched to:\n\`${thread.id}\`\n\nDirectory:\n\`${thread.workDir ?? '(unset)'}\``,
    { parse_mode: 'Markdown' },
  )
})

bot.on('message:text', async (ctx: Context) => {
  const userId = ctx.from?.id ?? 0
  if (!isAllowedUser(userId)) return

  const chatId = ctx.chat?.id
  if (!chatId) return

  const text = ctx.message?.text?.trim()
  if (!text || text.startsWith('/')) return
  const intent = classifyMessageIntent(text)
  await executePrompt(ctx, text, intent, text)
})

console.log('✅ Codex Telegram Bridge starting…')
console.log(`📂 Initial work dir: ${config.initialWorkDir ?? '(none)'}`)
console.log(`🗂️ State file: ${config.stateFile}`)
console.log(`👤 Allowed users: ${config.allowedUserIds.join(', ') || '(none — set ALLOWED_USER_IDS)'}`)

bot.start({
  onStart: (info) => console.log(`🤖 Bot ready: @${info.username}`),
}).catch(err => {
  console.error('Failed to start bot:', err.message)
  process.exit(1)
})


