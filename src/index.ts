import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { Bot, InlineKeyboard, type Context } from 'grammy'
import { registerApprovalHandlers, requestApproval } from './approval.js'
import { config, isAllowedUser } from './config.js'
import { runCodex } from './codex.js'
import { StateStore, createDraftThread, summarizePrompt, type ThreadSummary } from './state.js'

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

bot.command('start', async (ctx) => {
  if (!isAllowedUser(ctx.from?.id ?? 0)) return
  await ctx.reply(
    '👋 *Codex Bridge ready*\n\n' +
    'Commands:\n' +
    '`/new` — new thread using the current thread directory\n' +
    '`/new <absolute-path>` — new thread bound to a specific directory\n' +
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

  if (isBusy(chatId)) {
    await sendBusyMessage(ctx, chatId)
    return
  }

  let activeThread = getCurrentThread(chatId)
  if (!activeThread) {
    if (!config.initialWorkDir) {
      await ctx.reply('No active thread or default work dir. Use /new <absolute-path> first.')
      return
    }

    const initialWorkDir = await validateWorkDir(config.initialWorkDir).catch(() => null)
    if (!initialWorkDir) {
      await ctx.reply('Configured WORK_DIR is invalid. Use /new <absolute-path> first or fix .env.')
      return
    }

    activeThread = createDraftThread(initialWorkDir)
    await store.createThread(chatId, activeThread)
    await store.setCurrentThread(chatId, activeThread.id)
  }

  if (!activeThread.workDir) {
    await ctx.reply('This thread has no work dir. Use /new <absolute-path> to create a runnable thread.')
    return
  }

  if (config.approvalMode === 'on-request') {
    pendingApprovals.add(chatId)
    try {
      const approved = await requestApproval(bot, chatId, userId, text)
      if (!approved) return
    } finally {
      pendingApprovals.delete(chatId)
    }
  }

  const abortController = new AbortController()
  runningTasks.set(chatId, abortController)

  const statusMsg = await ctx.reply('⏳ Codex is working…').catch(() => null)
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
      prompt: text,
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
        await syncThreadState(chatId, activeThread as ThreadSummary, threadId, title)
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


