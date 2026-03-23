import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
  type TextChannel,
  type DMChannel,
} from 'discord.js'
import { config } from './config.js'

type AllowedChannel = TextChannel | DMChannel

/**
 * Sends an approval prompt to Discord with Allow / Deny buttons.
 * Blocks until the user responds or the timeout expires.
 *
 * Returns true if approved, false if denied or timed out.
 */
export async function requestApproval(
  channel: AllowedChannel,
  prompt: string,
  requesterId: string,
): Promise<boolean> {
  const preview = prompt.length > 300
    ? prompt.slice(0, 300) + '…'
    : prompt

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('approve')
      .setLabel('✅ Allow')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('deny')
      .setLabel('❌ Deny')
      .setStyle(ButtonStyle.Danger),
  )

  const approvalMsg = await channel.send({
    content: [
      '**⏳ Awaiting approval**',
      '```',
      preview,
      '```',
      `-# Timeout in ${Math.round(config.approvalTimeoutMs / 60000)} min`,
    ].join('\n'),
    components: [row],
  })

  try {
    const interaction = await approvalMsg.awaitMessageComponent({
      componentType: ComponentType.Button,
      // Only the original requester can approve/deny
      filter: i => i.user.id === requesterId,
      time: config.approvalTimeoutMs,
    })

    const approved = interaction.customId === 'approve'

    await interaction.update({
      content: approved
        ? '**✅ Approved** — running Codex…'
        : '**❌ Denied** — task cancelled.',
      components: [],
    })

    return approved
  } catch {
    // Timeout: awaitMessageComponent throws if time expires
    await approvalMsg.edit({
      content: '**⏱️ Timed out** — task cancelled (no response within timeout).',
      components: [],
    })
    return false
  }
}
