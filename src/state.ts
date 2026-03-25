import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ThreadSummary = {
  id: string
  title: string
  lastUsedAt: string
  workDir: string | null
}

export type ChatState = {
  currentThreadId: string | null
  recentThreadIds: string[]
}

type BridgeState = {
  chats: Record<string, ChatState>
  threads: Record<string, ThreadSummary>
}

const EMPTY_STATE: BridgeState = {
  chats: {},
  threads: {},
}

export class StateStore {
  private state: BridgeState = structuredClone(EMPTY_STATE)

  constructor(
    private readonly filePath: string,
    private readonly maxRecentThreads: number,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<BridgeState>
      this.state = {
        chats: parsed.chats ?? {},
        threads: parsed.threads ?? {},
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code !== 'ENOENT') throw err
      await this.save()
    }
  }

  getChat(chatId: number): ChatState {
    const key = String(chatId)
    if (!this.state.chats[key]) {
      this.state.chats[key] = {
        currentThreadId: null,
        recentThreadIds: [],
      }
    }
    return this.state.chats[key]
  }

  getThread(threadId: string | null): ThreadSummary | null {
    if (!threadId) return null
    return this.state.threads[threadId] ?? null
  }

  listThreads(chatId: number): ThreadSummary[] {
    const chat = this.getChat(chatId)
    return chat.recentThreadIds
      .map(threadId => this.getThread(threadId))
      .filter((thread): thread is ThreadSummary => thread !== null)
  }

  async createThread(chatId: number, thread: ThreadSummary): Promise<void> {
    this.state.threads[thread.id] = thread
    this.promoteThread(chatId, thread.id)
    await this.save()
  }

  async updateThread(threadId: string, update: Partial<ThreadSummary>): Promise<void> {
    const existing = this.getThread(threadId)
    if (!existing) return
    this.state.threads[threadId] = {
      ...existing,
      ...update,
    }
    await this.save()
  }

  async setCurrentThread(chatId: number, threadId: string | null): Promise<void> {
    const chat = this.getChat(chatId)
    chat.currentThreadId = threadId
    if (threadId) this.promoteThread(chatId, threadId)
    await this.save()
  }

  async touchThread(chatId: number, threadId: string, title?: string): Promise<void> {
    const existing = this.getThread(threadId)
    if (!existing) return
    this.state.threads[threadId] = {
      ...existing,
      title: title ?? existing.title,
      lastUsedAt: new Date().toISOString(),
    }
    this.promoteThread(chatId, threadId)
    await this.save()
  }

  async replaceThreadId(oldId: string, newThread: ThreadSummary): Promise<void> {
    if (oldId !== newThread.id) {
      delete this.state.threads[oldId]
    }
    this.state.threads[newThread.id] = newThread

    for (const chat of Object.values(this.state.chats)) {
      if (chat.currentThreadId === oldId) chat.currentThreadId = newThread.id
      chat.recentThreadIds = dedupe(chat.recentThreadIds.map(threadId =>
        threadId === oldId ? newThread.id : threadId,
      )).slice(0, this.maxRecentThreads)
    }

    await this.save()
  }

  private promoteThread(chatId: number, threadId: string): void {
    const chat = this.getChat(chatId)
    chat.recentThreadIds = dedupe([threadId, ...chat.recentThreadIds]).slice(0, this.maxRecentThreads)
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export function createDraftThread(workDir: string | null): ThreadSummary {
  const now = new Date().toISOString()
  return {
    id: `draft-${Date.now()}`,
    title: 'New thread',
    lastUsedAt: now,
    workDir,
  }
}

export function summarizePrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  if (!compact) return 'New thread'
  return compact.length > 60 ? compact.slice(0, 57) + '...' : compact
}
