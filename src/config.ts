import 'dotenv/config'

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  // Telegram
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  allowedUserIds: (process.env.ALLOWED_USER_IDS || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(Boolean),

  // Codex
  workDir: process.env.WORK_DIR || process.cwd(),
  model: process.env.CODEX_MODEL || 'o4-mini',
  approvalMode: (process.env.APPROVAL_MODE || 'on-request') as 'on-request' | 'auto',

  // Timeouts
  approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || '300000'), // 5 min
  streamDebounceMs: parseInt(process.env.STREAM_DEBOUNCE_MS || '2000'),

  // Telegram message limit (4096 chars, leave buffer)
  maxMessageLength: 4000,
}

export function isAllowedUser(userId: number): boolean {
  if (config.allowedUserIds.length === 0) return false
  return config.allowedUserIds.includes(userId)
}
