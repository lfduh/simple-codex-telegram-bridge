import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  // Discord
  discordToken: required('DISCORD_BOT_TOKEN'),
  allowedUserIds: (process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Codex
  workDir: process.env.WORK_DIR || process.cwd(),
  model: process.env.CODEX_MODEL || 'o4-mini',
  approvalMode: (process.env.APPROVAL_MODE || 'on-request') as 'on-request' | 'auto',

  // Timeouts
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || '300000'), // 5 min
  streamDebounceMs: parseInt(process.env.STREAM_DEBOUNCE_MS || '1500'),     // Discord rate limit buffer

  // Output
  maxMessageLength: 1900, // Discord limit is 2000, leave buffer for formatting
}

export function isAllowedUser(userId: string): boolean {
  if (config.allowedUserIds.length === 0) return false
  return config.allowedUserIds.includes(userId)
}
