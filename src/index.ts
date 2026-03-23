import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  type TextChannel,
  type DMChannel,
} from 'discord.js'
import { config, isAllowedUser } from './config.js'
import { requestApproval } from './approval.js'
import { runCodex } from './codex.js'

// ── Debounced Discord message edit ────────────────────────────────────────────
// Discord rate-limits edits — we batch updates and flush every N ms.

function makeDebouncer(flushMs: number) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return function debounce(key: string, fn: () => Promise<void>) {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)
    timers.set(key, setTimeout(async () => {
      timers.delete(key)
      await fn()
    }, flushMs))
  }
}

// ── Message chunking ──────────────────────────────────────────────────────────
// Discord hard limit is 2000 chars. We split on newlines where possible.

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

// ── Active sessions ───────────────────────────────────────────────────────────
// Track running tasks per channel so we can reject concurrent requests
// and support a future /stop command.

const activeSessions = new Map<string, AbortController>()

// ── Bot setup ─────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
})

client.once(Events.ClientReady, c => {
  console.log(`✅ Ready — logged in as ${c.user.tag}`)
  console.log(`📂 Work dir: ${config.workDir}`)
  console.log(`👤 Allowed users: ${config.allowedUserIds.join(', ') || '(none — set ALLOWED_USER_IDS)'}`)
})

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bots (including ourselves)
  if (message.author.bot) return

  // Whitelist check
  if (!isAllowedUser(message.author.id)) return

  const content = message.content.trim()
  if (!content) return

  // Built-in stop command
  if (content === '/stop') {
    const session = activeSessions.get(message.channelId)
    if (session) {
      session.abort()
      await message.reply('⛔ Stopping current task…')
    } else {
      await message.reply('No active task in this channel.')
    }
    return
  }

  // Reject if a task is already running in this channel
  if (activeSessions.has(message.channelId)) {
    await message.reply('⏳ A task is already running. Send `/stop` to cancel it first.')
    return
  }

  const channel = message.channel as TextChannel | DMChannel

  // ── Approval gate ──────────────────────────────────────────────────────────
  if (config.approvalMode === 'on-request') {
    const approved = await requestApproval(channel, content, message.author.id)
    if (!approved) return
  }

  // ── Run Codex ──────────────────────────────────────────────────────────────
  const abortController = new AbortController()
  activeSessions.set(message.channelId, abortController)

  // Initial status message — we'll edit this as output streams in
  const statusMsg = await channel.send('⏳ Codex is working…')
  const extraMsgs: Message[] = [] // overflow messages for long output
  const debounce = makeDebouncer(config.streamDebounceMs)

  let latestText = ''

  const flushToDiscord = async (text: string) => {
    latestText = text
    const chunks = splitIntoChunks(text, config.maxMessageLength)

    // Edit the first (status) message
    await statusMsg.edit(chunks[0] ?? '…')

    // Send/edit overflow messages
    for (let i = 1; i < chunks.length; i++) {
      if (i - 1 < extraMsgs.length) {
        await extraMsgs[i - 1].edit(chunks[i])
      } else {
        const m = await channel.send(chunks[i])
        extraMsgs.push(m)
      }
    }
  }

  await runCodex(
    content,

    // onChunk — debounced live update
    (text) => {
      debounce(message.channelId, () => flushToDiscord(text))
    },

    // onDone — final flush + completion marker
    async (text) => {
      activeSessions.delete(message.channelId)
      const final = (text || '*(no output)*') + '\n\n✅ **Done**'
      await flushToDiscord(final)
    },

    // onError
    async (err) => {
      activeSessions.delete(message.channelId)
      console.error('Codex error:', err)
      await statusMsg.edit(`❌ **Error:** ${err.message}`)
    },

    abortController.signal,
  )
})

// ── Start ─────────────────────────────────────────────────────────────────────

client.login(config.discordToken).catch(err => {
  console.error('Failed to log in to Discord:', err.message)
  process.exit(1)
})
