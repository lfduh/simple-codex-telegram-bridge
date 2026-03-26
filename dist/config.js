import { config as loadEnv } from 'dotenv';
import { defaultStateFile, envFilePath } from './paths.js';
loadEnv({ path: envFilePath });
function required(key) {
    const val = process.env[key];
    if (!val)
        throw new Error(`Missing required env var: ${key}`);
    return val;
}
export const config = {
    telegramToken: required('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: (process.env.ALLOWED_USER_IDS || '')
        .split(',')
        .map(s => Number(s.trim()))
        .filter(Boolean),
    initialWorkDir: process.env.WORK_DIR || null,
    model: process.env.CODEX_MODEL || 'gpt-5-mini',
    approvalMode: (process.env.APPROVAL_MODE || 'auto'),
    stateFile: process.env.STATE_FILE || defaultStateFile,
    approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || '300000'),
    streamDebounceMs: parseInt(process.env.STREAM_DEBOUNCE_MS || '2000'),
    maxMessageLength: 4000,
    maxRecentThreads: parseInt(process.env.MAX_RECENT_THREADS || '10'),
};
export function isAllowedUser(userId) {
    if (config.allowedUserIds.length === 0)
        return false;
    return config.allowedUserIds.includes(userId);
}
