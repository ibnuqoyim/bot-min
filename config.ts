import 'dotenv/config'

function required(key: string): string {
    const val = process.env[key]
    if (!val) throw new Error(`Missing required env var: ${key}`)
    return val
}

function optional(key: string, fallback: string): string {
    return process.env[key] || fallback
}

export type ProviderName = 'ollama' | 'openrouter' | 'claude' | 'openai'

const provider = optional('AI_PROVIDER', 'ollama') as ProviderName

export const config = {
    // ── WhatsApp ──────────────────────────────────────────────────────────────
    // Comma-separated list of phone numbers allowed to talk to the bot.
    // Format: international without '+' → e.g. 6281234567890,6289876543210
    allowedNumbers: optional('ALLOWED_WA_NUMBERS', '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean),

    sessionPath: optional('WA_SESSION_PATH', './bot/session'),

    // ── AI ────────────────────────────────────────────────────────────────────
    provider,

    ollama: {
        baseUrl: optional('OLLAMA_BASE_URL', 'http://localhost:11434'),
        // Must support tool calling: qwen2.5:7b, llama3.1:8b, mistral-nemo
        model: optional('OLLAMA_MODEL', 'qwen2.5:7b'),
    },

    openrouter: {
        apiKey: optional('OPENROUTER_API_KEY', ''),
        model: optional('OPENROUTER_MODEL', 'anthropic/claude-3.5-haiku'),
        // Shown in OpenRouter dashboard under your app
        siteName: optional('OPENROUTER_SITE_NAME', 'Store Dashboard Bot'),
    },

    claude: {
        apiKey: optional('CLAUDE_API_KEY', ''),
        model: optional('CLAUDE_MODEL', 'claude-haiku-4-5-20251001'),
    },

    openai: {
        apiKey: optional('OPENAI_API_KEY', ''),
        model: optional('OPENAI_MODEL', 'gpt-4o-mini'),
    },

    // ── Conversation ──────────────────────────────────────────────────────────
    // Max user+assistant turns kept in memory per user (system msg excluded)
    maxHistoryMessages: Number(optional('MAX_HISTORY_MESSAGES', '20')),

    // ── Supabase (used in Phase 3 tools) ─────────────────────────────────────
    supabase: {
        url: optional('NEXT_PUBLIC_SUPABASE_URL', ''),
        // Service role key bypasses RLS — never expose to browser
        serviceKey: optional('SUPABASE_SERVICE_ROLE_KEY', ''),
    },

    // ── Multi-store ───────────────────────────────────────────────────────────
    // Set BOT_STORE_ID on each Fly.io instance to identify which store this
    // bot belongs to. The bot will read bot_config WHERE store_id = BOT_STORE_ID.
    // If not set, the bot reads the first bot_config row (single-store mode).
    botStoreId: optional('BOT_STORE_ID', ''),

    // ── System prompt ─────────────────────────────────────────────────────────
    systemPrompt: optional(
        'BOT_SYSTEM_PROMPT',
        `Kamu adalah asisten toko sourdough yang membantu pemilik toko via WhatsApp.
Gunakan bahasa Indonesia yang santai tapi sopan.
Jawab pertanyaan singkat dan jelas. Gunakan emoji secukupnya.

Kamu bisa membantu dengan perintah berikut (ketik persis formatnya):
- /resume → ringkasan order di batch terbaru
- /cari <nama> → cari pesanan by nama pemesan
- /order <nama> | <produk:qty,...> → buat order baru
- /po baru <nama> → buat batch PO baru
- /help → lihat semua perintah

Jika pemilik bertanya tentang data toko, arahkan ke perintah di atas.`
    ),
}

// Validate provider-specific required keys at startup
export function validateConfig() {
    const errs: string[] = []

    if (config.allowedNumbers.length === 0) {
        errs.push('ALLOWED_WA_NUMBERS is empty — bot will not respond to anyone')
    }

    if (provider === 'openrouter' && !config.openrouter.apiKey) {
        errs.push('OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter')
    }
    if (provider === 'claude' && !config.claude.apiKey) {
        errs.push('CLAUDE_API_KEY is required when AI_PROVIDER=claude')
    }
    if (provider === 'openai' && !config.openai.apiKey) {
        errs.push('OPENAI_API_KEY is required when AI_PROVIDER=openai')
    }

    if (errs.length > 0) {
        errs.forEach(e => console.warn(`[config] ⚠  ${e}`))
    }

    console.log(`[config] provider=${provider} | allowed=${config.allowedNumbers.length} number(s)`)
}
