import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const EMPTY_STATE = {
    chats: {},
    threads: {},
};
export class StateStore {
    filePath;
    maxRecentThreads;
    state = structuredClone(EMPTY_STATE);
    constructor(filePath, maxRecentThreads) {
        this.filePath = filePath;
        this.maxRecentThreads = maxRecentThreads;
    }
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            this.state = {
                chats: parsed.chats ?? {},
                threads: parsed.threads ?? {},
            };
        }
        catch (err) {
            const error = err;
            if (error.code !== 'ENOENT')
                throw err;
            await this.save();
        }
    }
    getChat(chatId) {
        const key = String(chatId);
        if (!this.state.chats[key]) {
            this.state.chats[key] = {
                currentThreadId: null,
                recentThreadIds: [],
            };
        }
        return this.state.chats[key];
    }
    getThread(threadId) {
        if (!threadId)
            return null;
        return this.state.threads[threadId] ?? null;
    }
    listThreads(chatId) {
        const chat = this.getChat(chatId);
        return chat.recentThreadIds
            .map(threadId => this.getThread(threadId))
            .filter((thread) => thread !== null);
    }
    async createThread(chatId, thread) {
        this.state.threads[thread.id] = thread;
        this.promoteThread(chatId, thread.id);
        await this.save();
    }
    async updateThread(threadId, update) {
        const existing = this.getThread(threadId);
        if (!existing)
            return;
        this.state.threads[threadId] = {
            ...existing,
            ...update,
        };
        await this.save();
    }
    async setCurrentThread(chatId, threadId) {
        const chat = this.getChat(chatId);
        chat.currentThreadId = threadId;
        if (threadId)
            this.promoteThread(chatId, threadId);
        await this.save();
    }
    async touchThread(chatId, threadId, title) {
        const existing = this.getThread(threadId);
        if (!existing)
            return;
        this.state.threads[threadId] = {
            ...existing,
            title: title ?? existing.title,
            lastUsedAt: new Date().toISOString(),
        };
        this.promoteThread(chatId, threadId);
        await this.save();
    }
    async replaceThreadId(oldId, newThread) {
        if (oldId !== newThread.id) {
            delete this.state.threads[oldId];
        }
        this.state.threads[newThread.id] = newThread;
        for (const chat of Object.values(this.state.chats)) {
            if (chat.currentThreadId === oldId)
                chat.currentThreadId = newThread.id;
            chat.recentThreadIds = dedupe(chat.recentThreadIds.map(threadId => threadId === oldId ? newThread.id : threadId)).slice(0, this.maxRecentThreads);
        }
        await this.save();
    }
    promoteThread(chatId, threadId) {
        const chat = this.getChat(chatId);
        chat.recentThreadIds = dedupe([threadId, ...chat.recentThreadIds]).slice(0, this.maxRecentThreads);
    }
    async save() {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    }
}
function dedupe(values) {
    return [...new Set(values)];
}
export function createDraftThread(workDir) {
    const now = new Date().toISOString();
    return {
        id: `draft-${Date.now()}`,
        title: 'New thread',
        lastUsedAt: now,
        workDir,
    };
}
export function summarizePrompt(prompt) {
    const compact = prompt.replace(/\s+/g, ' ').trim();
    if (!compact)
        return 'New thread';
    return compact.length > 60 ? compact.slice(0, 57) + '...' : compact;
}
