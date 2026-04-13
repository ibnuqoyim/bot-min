import OpenAI from 'openai'
import { config } from '../config.ts'
import type { AIProvider, Message } from './types.ts'

export class OpenAIProvider implements AIProvider {
    readonly name = 'openai'

    private client: OpenAI

    constructor() {
        this.client = new OpenAI({ apiKey: config.openai.apiKey })
    }

    async chat(messages: Message[]): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: config.openai.model,
            messages,
        })

        return response.choices[0]?.message?.content?.trim() ?? ''
    }
}
