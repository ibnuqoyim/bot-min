import { config } from '../config.ts'
import type { AIProvider, Message } from './types.ts'

type OllamaChatResponse = {
    message: { role: string; content: string }
    done: boolean
    error?: string
}

export class OllamaProvider implements AIProvider {
    readonly name = 'ollama'

    async chat(messages: Message[]): Promise<string> {
        const url = `${config.ollama.baseUrl}/api/chat`

        let res: Response
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.ollama.model,
                    messages,
                    stream: false,
                }),
            })
        } catch (err) {
            throw new Error(
                `Ollama tidak dapat dihubungi di ${config.ollama.baseUrl}. ` +
                `Pastikan Ollama sedang berjalan (ollama serve).`
            )
        }

        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`Ollama error ${res.status}: ${body}`)
        }

        const data = (await res.json()) as OllamaChatResponse

        if (data.error) throw new Error(`Ollama: ${data.error}`)

        return data.message?.content?.trim() ?? ''
    }
}
