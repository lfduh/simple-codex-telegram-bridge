export async function runCodex(options) {
    const { prompt, workDir, model, threadId, signal, onChunk, onDone, onError } = options;
    let Codex;
    try {
        const sdk = await import('@openai/codex-sdk');
        Codex = sdk.Codex;
    }
    catch {
        throw new Error('Codex SDK not found. Run: npm install @openai/codex-sdk\n' +
            'Then authenticate: codex auth login (or set OPENAI_API_KEY)');
    }
    const codex = new Codex();
    const thread = threadId
        ? codex.resumeThread(threadId, {
            model,
            ...(workDir ? { workingDirectory: workDir } : {}),
            approvalPolicy: 'never',
            skipGitRepoCheck: true,
        })
        : codex.startThread({
            model,
            ...(workDir ? { workingDirectory: workDir } : {}),
            approvalPolicy: 'never',
            skipGitRepoCheck: true,
        });
    const agentMessages = new Map();
    const agentOrder = [];
    const activityById = new Map();
    const renderOutput = () => {
        const messageText = agentOrder
            .map(id => agentMessages.get(id) ?? '')
            .filter(Boolean)
            .join('\n\n');
        const activityText = [...activityById.values()].join('\n');
        return [messageText, activityText].filter(Boolean).join('\n\n');
    };
    try {
        const { events } = await thread.runStreamed(prompt, { signal });
        for await (const event of events) {
            if (event.type === 'error') {
                throw new Error(event.message ?? 'Codex returned an error event');
            }
            if (event.type === 'turn.failed') {
                throw new Error(event.error.message ?? 'Codex turn failed');
            }
            if (event.type !== 'item.started' && event.type !== 'item.completed' && event.type !== 'item.updated') {
                continue;
            }
            const item = event.item;
            if (item.type === 'agent_message') {
                if (!agentOrder.includes(item.id))
                    agentOrder.push(item.id);
                agentMessages.set(item.id, item.text);
                await onChunk(renderOutput());
                continue;
            }
            if (event.type === 'item.started') {
                if (item.type === 'command_execution') {
                    activityById.set(item.id, `[$] ${item.command}`);
                    await onChunk(renderOutput());
                }
                else if (item.type === 'mcp_tool_call') {
                    activityById.set(item.id, `[tool] ${item.server}/${item.tool}`);
                    await onChunk(renderOutput());
                }
                continue;
            }
            if (event.type === 'item.completed') {
                if (item.type === 'command_execution') {
                    const exitSuffix = item.exit_code !== undefined ? ` (exit ${item.exit_code})` : '';
                    activityById.set(item.id, `[$] ${item.command}${exitSuffix}`);
                    await onChunk(renderOutput());
                }
                else if (item.type === 'mcp_tool_call') {
                    const statusText = item.status === 'failed'
                        ? `failed: ${item.error?.message ?? 'unknown error'}`
                        : 'done';
                    activityById.set(item.id, `[tool] ${item.server}/${item.tool} (${statusText})`);
                    await onChunk(renderOutput());
                }
                else if (item.type === 'error') {
                    throw new Error(item.message);
                }
            }
        }
        const resolvedThreadId = thread.id;
        if (!resolvedThreadId)
            throw new Error('Codex did not return a thread id');
        await onDone({
            fullText: renderOutput() || '(no output)',
            threadId: resolvedThreadId,
        });
    }
    catch (err) {
        if (signal?.aborted) {
            const resolvedThreadId = thread.id;
            if (!resolvedThreadId) {
                await onError(new Error('Codex task was stopped before a thread id was created'));
                return;
            }
            await onDone({
                fullText: (renderOutput() || '(no output)') + '\n\nStopped.',
                threadId: resolvedThreadId,
            });
        }
        else {
            await onError(err instanceof Error ? err : new Error(String(err)));
        }
    }
}
