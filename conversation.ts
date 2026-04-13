import { config } from './config.ts'
import type { Message } from './providers/types.ts'

// In-memory store: jid → conversation history (user+assistant only)
const store = new Map<string, Message[]>()

/**
 * Get full message list for a JID, ready to pass to AI provider.
 * System prompt is always prepended; history follows.
 */
export function getMessages(jid: string, systemPrompt: string): Message[] {
    const history = store.get(jid) ?? []
    return [{ role: 'system', content: systemPrompt }, ...history]
}

/**
 * Append a message to a user's history and trim to max length.
 */
export function appendMessage(jid: string, role: 'user' | 'assistant', content: string): void {
    if (!store.has(jid)) store.set(jid, [])
    const history = store.get(jid)!

    history.push({ role, content })

    // Keep only the last N messages to stay within context window
    while (history.length > config.maxHistoryMessages) {
        history.shift()
    }
}

/**
 * Clear conversation history for a JID.
 */
export function resetHistory(jid: string): void {
    store.delete(jid)
}

/**
 * Returns current message count for a JID (for logging).
 */
export function historyLength(jid: string): number {
    return store.get(jid)?.length ?? 0
}
