import { config, type ProviderName } from '../config.ts'
import type { AIProvider } from './types.ts'

export type { AIProvider, Message } from './types.ts'

export async function createProvider(): Promise<AIProvider> {
    const name: ProviderName = config.provider

    switch (name) {
        case 'ollama': {
            const { OllamaProvider } = await import('./ollama.ts')
            return new OllamaProvider()
        }
        case 'openrouter': {
            const { OpenRouterProvider } = await import('./openrouter.ts')
            return new OpenRouterProvider()
        }
        case 'claude': {
            const { ClaudeProvider } = await import('./claude.ts')
            return new ClaudeProvider()
        }
        case 'openai': {
            const { OpenAIProvider } = await import('./openai.ts')
            return new OpenAIProvider()
        }
        default:
            throw new Error(
                `Unknown AI_PROVIDER: "${name}". ` +
                `Valid options: ollama | openrouter | claude | openai`
            )
    }
}
