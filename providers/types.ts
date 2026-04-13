export type Role = 'system' | 'user' | 'assistant'

export type Message = {
    role: Role
    content: string
}

/**
 * Common interface for all AI providers.
 * Phase 3 will extend this with tool calling support.
 */
export interface AIProvider {
    /** Send a conversation and return the assistant's reply. */
    chat(messages: Message[]): Promise<string>

    /** Provider name — used in logs. */
    readonly name: string
}
