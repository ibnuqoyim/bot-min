import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.ts'
import type { AIProvider, Message } from './types.ts'

export class ClaudeProvider implements AIProvider {
    readonly name = 'claude'

    private client: Anthropic

    constructor() {
        this.client = new Anthropic({ apiKey: config.claude.apiKey })
    }

    async chat(messages: Message[]): Promise<string> {
        // Claude treats system separately from conversation turns
        const systemMsg = messages.find(m => m.role === 'system')
        const turns = messages.filter(m => m.role !== 'system')

        const response = await this.client.messages.create({
            model: config.claude.model,
            max_tokens: 1024,
            ...(systemMsg ? { system: systemMsg.content } : {}),
            messages: turns.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
        })

        const block = response.content[0]
        return block?.type === 'text' ? block.text.trim() : ''
    }
}
