import OpenAI from 'openai'
import { config } from '../config.ts'
import type { AIProvider, Message } from './types.ts'

export class OpenRouterProvider implements AIProvider {
    readonly name = 'openrouter'

    private client: OpenAI

    constructor() {
        this.client = new OpenAI({
            apiKey: config.openrouter.apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://store-dashboard',
                'X-Title': config.openrouter.siteName,
            },
        })
    }

    async chat(messages: Message[]): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: config.openrouter.model,
            messages,
        })

        return response.choices[0]?.message?.content?.trim() ?? ''
    }
}
