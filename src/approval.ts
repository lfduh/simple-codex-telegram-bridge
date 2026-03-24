import { InlineKeyboard, type Bot, type Context } from 'grammy'
import { config } from './config.js'

/**
 * Sends an approval prompt with Allow / Deny inline keyboard buttons.
 * Blocks until the user responds or the timeout expires.
 *
 * Returns true if approved, false if denied or timed out.
 */
export async function requestApproval(
  bot: Bot,
  chatId: number,
  requesterId: number,
  prompt: string,
): Promise<boolean> {
  const preview = prompt.length > 500
    ? prompt.slice(0, 500) + '…'
    : prompt

  const keyboard = new InlineKeyboard()
    .text('✅ Allow', 'approve')
    .text('❌ Deny', 'deny')

  const msg = await bot.api.sendMessage(
    chatId,
    `⏳ *Awaiting approval*\n\`\`\`\n${preview}\n\`\`\`\n_Timeout: ${Math.round(config.approvalTimeoutMs / 60000)} min_`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    },
  )

  return new Promise<boolean>((resolve) => {
    // Timeout — auto-deny
    const timer = setTimeout(async () => {
      cleanup()
      await bot.api.editMessageText(
        chatId,
        msg.message_id,
        '⏱️ *Timed out* — task cancelled.',
        { parse_mode: 'Markdown' },
      )
      resolve(false)
    }, config.approvalTimeoutMs)

    // Listen for callback query on this specific message
    const handler = async (ctx: Context) => {
      const query = ctx.callbackQuery
      if (!query) return
      if (query.message?.message_id !== msg.message_id) return
      if (query.from.id !== requesterId) {
        // Someone else tapped — silently ignore
        await ctx.answerCallbackQuery()
        return
      }

      cleanup()
      await ctx.answerCallbackQuery()

      const approved = query.data === 'approve'
      await bot.api.editMessageText(
        chatId,
        msg.message_id,
        approved
          ? '✅ *Approved* — running Codex…'
          : '❌ *Denied* — task cancelled.',
        { parse_mode: 'Markdown' },
      )
      resolve(approved)
    }

    bot.on('callback_query:data', handler)

    function cleanup() {
      clearTimeout(timer)
      bot.off('callback_query:data', handler)
    }
  })
}
