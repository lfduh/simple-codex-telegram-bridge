import { InlineKeyboard, type Bot, type Context, type NextFunction } from 'grammy'
import { config } from './config.js'

type PendingApproval = {
  requesterId: number
  chatId: number
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

const approvals = new Map<string, PendingApproval>()

function approvalKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

export function registerApprovalHandlers(bot: Bot): void {
  bot.on('callback_query:data', async (ctx: Context, next: NextFunction) => {
    const query = ctx.callbackQuery
    const message = query?.message
    const messageId = message?.message_id
    const chatId = message?.chat.id
    if (!query || !messageId || !chatId) {
      await next()
      return
    }

    if (query.data !== 'approve' && query.data !== 'deny') {
      await next()
      return
    }

    const key = approvalKey(chatId, messageId)
    const pending = approvals.get(key)
    if (!pending) {
      await ctx.answerCallbackQuery({ text: 'Approval request expired.' })
      return
    }

    if (query.from.id !== pending.requesterId) {
      await ctx.answerCallbackQuery({ text: 'You cannot approve this request.' })
      return
    }

    approvals.delete(key)
    clearTimeout(pending.timeout)
    ctx.answerCallbackQuery().catch(() => undefined)

    const approved = query.data === 'approve'
    pending.resolve(approved)
    await bot.api.editMessageText(
      pending.chatId,
      messageId,
      approved
        ? '✅ *Approved* — running Codex…'
        : '❌ *Denied* — task cancelled.',
      { parse_mode: 'Markdown' },
    ).catch(() => undefined)
  })
}

export async function requestApproval(
  bot: Bot,
  chatId: number,
  requesterId: number,
  prompt: string,
): Promise<boolean> {
  const preview = prompt.length > 500
    ? prompt.slice(0, 500) + '...'
    : prompt
  const fencedPreview = preview.replace(/```/g, '``\\`')

  const keyboard = new InlineKeyboard()
    .text('✅ Allow', 'approve')
    .text('❌ Deny', 'deny')

  const msg = await bot.api.sendMessage(
    chatId,
    `⏳ *Awaiting approval*\n\`\`\`\n${fencedPreview}\n\`\`\`\n_Timeout: ${Math.round(config.approvalTimeoutMs / 60000)} min_`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    },
  )

  const key = approvalKey(chatId, msg.message_id)

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(async () => {
      approvals.delete(key)
      resolve(false)
      await bot.api.editMessageText(
        chatId,
        msg.message_id,
        '⏱️ *Timed out* — task cancelled.',
        { parse_mode: 'Markdown' },
      ).catch(() => undefined)
    }, config.approvalTimeoutMs)

    approvals.set(key, {
      requesterId,
      chatId,
      resolve,
      timeout: timer,
    })
  })
}
