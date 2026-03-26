import { homedir } from 'node:os';
import path from 'node:path';
export const defaultConfigDir = path.join(homedir(), '.codex-tg');
export const configDir = process.env.CODEX_TG_HOME || defaultConfigDir;
export const envFilePath = process.env.CODEX_TG_ENV_FILE || path.join(configDir, '.env');
export const defaultStateFile = path.join(configDir, 'data', 'state.json');
