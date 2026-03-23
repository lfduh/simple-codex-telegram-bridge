import { config } from './config.js'

export type ChunkCallback = (text: string) => void
export type DoneCallback = (fullText: string) => void
export type ErrorCallback = (err: Error) => void

/**
 * Runs a Codex session with streaming output.
 *
 * Events from the Codex SDK are mapped to simple callbacks
 * so the caller (Discord bot) doesn't need to know SDK internals.
 */
export async function runCodex(
  prompt: string,
  onChunk: ChunkCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  signal?: AbortSignal,
): Promise<void> {
  // Lazy import — keeps startup fast and surfaces missing SDK clearly
  let runStreamed: typeof import('@openai/codex-sdk').runStreamed
  try {
    const sdk = await import('@openai/codex-sdk')
    runStreamed = sdk.runStreamed
  } catch {
    throw new Error(
      'Codex SDK not found. Run: npm install @openai/codex-sdk\n' +
      'Then authenticate: codex auth login  (or set OPENAI_API_KEY)'
    )
  }

  let fullText = ''

  try {
    const stream = runStreamed({
      prompt,
      cwd: config.workDir,
      model: config.model,
      approvalPolicy: 'never', // approval is handled by us in Discord before this point
    })

    for await (const event of stream) {
      if (signal?.aborted) break

      // Accumulate assistant text chunks
      if (event.type === 'message' && event.role === 'assistant') {
        const chunk = extractText(event)
        if (chunk) {
          fullText += chunk
          onChunk(fullText)
        }
      }

      // Tool use — show as a status line (no approval needed, already approved above)
      if (event.type === 'tool_call' || event.type === 'function_call') {
        const toolName = event.name ?? event.function?.name ?? 'tool'
        const statusLine = `\n\`🔧 ${toolName}\``
        fullText += statusLine
        onChunk(fullText)
      }

      if (event.type === 'completed' || event.type === 'done') {
        break
      }

      if (event.type === 'error') {
        throw new Error(event.message ?? 'Codex returned an error event')
      }
    }

    onDone(fullText || '*(no output)*')
  } catch (err) {
    if (signal?.aborted) {
      onDone(fullText + '\n\n*⛔ Stopped.*')
    } else {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

/**
 * Extracts plain text from various message content shapes the SDK may return.
 * The Codex SDK event shape can vary — this handles the common cases defensively.
 */
function extractText(event: Record<string, unknown>): string {
  // String content
  if (typeof event.content === 'string') return event.content

  // Array of content blocks (OpenAI-style)
  if (Array.isArray(event.content)) {
    return event.content
      .filter((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text')
      .map((b: unknown) => (b as Record<string, unknown>).text as string)
      .join('')
  }

  // Delta format (streaming)
  if (event.delta && typeof (event.delta as Record<string, unknown>).text === 'string') {
    return (event.delta as Record<string, unknown>).text as string
  }

  return ''
}
