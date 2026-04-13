import { createServer } from 'node:http'
import { config, validateConfig } from './config.ts'

// Suppress verbose internal logs from libsignal / Baileys internals
// that bypass pino and write directly to console.log
const _origLog = console.log.bind(console)
console.log = (...args: unknown[]) => {
    const msg = String(args[0] ?? '')
    if (
        msg.startsWith('Closing session:') ||
        msg.startsWith('Session error:') ||
        msg.startsWith('Failed to decrypt') ||
        msg.includes('SessionEntry') ||
        msg.includes('_chains') ||
        msg.includes('registrationId')
    ) return
    _origLog(...args)
}
import { startConfigPolling } from './runtime-config.ts'
import { createProvider } from './providers/index.ts'
import { startWhatsApp } from './whatsapp.ts'

validateConfig()

// Minimal HTTP server — hanya untuk mencegah Fly.io auto-stop machine
const PORT = Number(process.env.PORT ?? 3001)
createServer((_, res) => {
    res.writeHead(200)
    res.end('ok')
}).listen(PORT, () => {
    console.log(`[bot] Health check listening on :${PORT}`)
})

console.log(`[bot] Starting WhatsApp AI Assistant`)
console.log(`[bot] AI Provider: ${config.provider}`)

// Load runtime config from Supabase (allowed_numbers, system_prompt, dll)
// dan poll setiap 5 menit untuk ambil perubahan dari dashboard
await startConfigPolling()

const provider = await createProvider()
await startWhatsApp(provider)
