/**
 * Runtime config — loaded from Supabase bot_config table, refreshed every 5 minutes.
 *
 * Two modes:
 *  - Multi-bot  (BOT_STORE_ID set): one bot per store, reads only that store's config.
 *  - Single-bot (BOT_STORE_ID not set): one bot for all stores, resolves store per sender.
 */
import { config } from './config.ts'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-store runtime binding resolved from bot_config rows. */
export interface StoreBinding {
    botConfigId: string
    storeId: string | null
    isActive: boolean
    systemPrompt: string
    aiProvider: string
    aiModel: string
    allowedNumbers: string[]
}

/** Backward-compat global config (first binding or env defaults). */
interface RuntimeConfig {
    isActive: boolean
    systemPrompt: string
    allowedNumbers: string[]
    aiProvider: string
    aiModel: string
    storeId: string | null
}

// ─── State ────────────────────────────────────────────────────────────────────

let globalConfig: RuntimeConfig = buildDefaults()
/** phone → first binding (backward compat) */
let numberToBinding = new Map<string, StoreBinding>()
/** phone → all accessible bindings (multi-store) */
let numberToBindings = new Map<string, StoreBinding[]>()
/** resolved JID → storeId the user has switched to this session */
const activeStoreByJid = new Map<string, string>()
let loadedBindings: StoreBinding[] = []
/** Set of phone numbers with super admin privileges (create/update stores). */
let superAdminSet = new Set<string>(config.superAdminNumbers)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDefaults(): RuntimeConfig {
    let aiModel = ''
    switch (config.provider) {
        case 'openrouter': aiModel = config.openrouter.model; break
        case 'claude':     aiModel = config.claude.model; break
        case 'openai':     aiModel = config.openai.model; break
        case 'ollama':     aiModel = config.ollama.model; break
    }
    return {
        isActive:       true,
        systemPrompt:   config.systemPrompt,
        allowedNumbers: config.allowedNumbers,
        aiProvider:     config.provider,
        aiModel,
        storeId:        config.botStoreId || null,
    }
}

function parseCsvPhones(csv: string): string[] {
    return csv ? csv.split(',').map((n: string) => n.trim()).filter(Boolean) : []
}

function buildBindingFromRow(row: Record<string, any>, defaults: RuntimeConfig): StoreBinding {
    return {
        botConfigId:    row.id,
        storeId:        row.store_id ?? null,
        isActive:       row.is_active ?? true,
        systemPrompt:   row.system_prompt?.trim() || defaults.systemPrompt,
        aiProvider:     row.ai_provider || defaults.aiProvider,
        aiModel:        row.ai_model    || defaults.aiModel,
        allowedNumbers: parseCsvPhones(row.allowed_numbers ?? ''),
    }
}

function rebuildLookup(bindings: StoreBinding[]) {
    const allMap  = new Map<string, StoreBinding[]>()
    const firstMap = new Map<string, StoreBinding>()

    for (const b of bindings) {
        for (const phone of b.allowedNumbers) {
            // Collect all bindings per phone (multi-store)
            const list = allMap.get(phone) ?? []
            if (!list.find(x => x.storeId === b.storeId)) list.push(b)
            allMap.set(phone, list)

            // First binding per phone (backward compat)
            if (!firstMap.has(phone)) firstMap.set(phone, b)
        }
    }

    numberToBindings = allMap
    numberToBinding  = firstMap
}

// ─── Load from Supabase ───────────────────────────────────────────────────────

async function loadFromSupabase(): Promise<void> {
    if (!config.supabase.url || !config.supabase.serviceKey) return

    try {
        const { getSupabase } = await import('./supabase.ts')
        const sb = getSupabase()

        let query = sb.from('bot_config').select('*')

        // Multi-bot mode: restrict to one store's config
        if (config.botStoreId) {
            query = query.eq('store_id', config.botStoreId)
        }

        const { data: rows } = await query

        if (!rows || rows.length === 0) return

        const defaults = buildDefaults()
        loadedBindings = rows.map(row => buildBindingFromRow(row, defaults))

        // Rebuild phone lookup
        rebuildLookup(loadedBindings)

        // Rebuild super admin set: env vars + all super_admin_numbers from DB
        superAdminSet = new Set(config.superAdminNumbers)
        for (const row of rows) {
            for (const phone of parseCsvPhones(row.super_admin_numbers ?? '')) {
                superAdminSet.add(phone)
            }
        }
        console.log(`[config] Super admins: ${superAdminSet.size} number(s)`)

        // Global config = first binding (for AI startup / backward compat)
        const first = loadedBindings[0]
        globalConfig = {
            isActive:       first.isActive,
            systemPrompt:   first.systemPrompt,
            allowedNumbers: first.allowedNumbers,
            aiProvider:     first.aiProvider,
            aiModel:        first.aiModel,
            storeId:        first.storeId,
        }

        const mode = config.botStoreId ? 'multi-bot' : 'single-bot'
        console.log(`[config] Synced ${loadedBindings.length} bot config(s) [${mode}]`)
    } catch (err: any) {
        console.warn('[config] Could not sync runtime config:', err.message)
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Backward-compat: returns the first/only config. Use resolveStoreForNumber() for per-message logic. */
export function getRuntimeConfig(): RuntimeConfig {
    return globalConfig
}

/**
 * Resolve which store a phone number belongs to (first/default binding).
 * Returns null if the number is not whitelisted in any store.
 */
export function resolveStoreForNumber(phone: string): StoreBinding | null {
    // In multi-bot mode with no DB loaded yet, fall back to env-based allowedNumbers
    if (config.botStoreId && numberToBinding.size === 0) {
        const defaults = buildDefaults()
        if (defaults.allowedNumbers.includes(phone)) {
            return {
                botConfigId:    '',
                storeId:        defaults.storeId,
                isActive:       defaults.isActive,
                systemPrompt:   defaults.systemPrompt,
                aiProvider:     defaults.aiProvider,
                aiModel:        defaults.aiModel,
                allowedNumbers: defaults.allowedNumbers,
            }
        }
        return null
    }
    return numberToBinding.get(phone) ?? null
}

/**
 * Resolve the currently active store binding for a JID.
 * Respects per-session store switch (/store switch), falls back to first binding.
 */
export function resolveActiveBinding(phone: string, jid: string): StoreBinding | null {
    // Multi-bot mode with no DB: fall back to env defaults
    if (config.botStoreId && numberToBindings.size === 0) {
        return resolveStoreForNumber(phone)
    }

    const bindings = numberToBindings.get(phone) ?? []
    if (bindings.length === 0) {
        // LID fallback handled in whatsapp.ts; return null here
        return null
    }

    // Check if user has switched to a specific store this session
    const override = activeStoreByJid.get(jid)
    if (override) {
        const found = bindings.find(b => b.storeId === override)
        if (found) return found
        // Override stale (store removed from whitelist) — clear and use first
        activeStoreByJid.delete(jid)
    }

    return bindings[0]
}

/**
 * All store bindings accessible to a phone number.
 */
export function getAccessibleBindings(phone: string): StoreBinding[] {
    if (config.botStoreId && numberToBindings.size === 0) {
        const b = resolveStoreForNumber(phone)
        return b ? [b] : []
    }
    return numberToBindings.get(phone) ?? []
}

/**
 * Switch the active store for a JID.
 * Accepts a full store UUID or a prefix (min 4 chars).
 * Returns the matched binding, or null if no match / not accessible.
 */
export function switchActiveStore(phone: string, jid: string, storeIdOrPrefix: string): StoreBinding | null {
    const bindings = numberToBindings.get(phone) ?? []
    const match = bindings.find(b =>
        b.storeId === storeIdOrPrefix ||
        (storeIdOrPrefix.length >= 4 && b.storeId?.startsWith(storeIdOrPrefix))
    )
    if (!match || !match.storeId) return null
    activeStoreByJid.set(jid, match.storeId)
    return match
}

/** Add a phone number to a specific store's whitelist and reload config. */
export async function addNumberToWhitelist(phoneNumber: string, storeId: string): Promise<void> {
    if (!config.supabase.url || !config.supabase.serviceKey) {
        throw new Error('Supabase belum dikonfigurasi.')
    }

    const { getSupabase } = await import('./supabase.ts')
    const sb = getSupabase()

    const { data } = await sb
        .from('bot_config')
        .select('id, allowed_numbers')
        .eq('store_id', storeId)
        .limit(1)
        .maybeSingle()

    if (!data) {
        throw new Error('Bot config untuk toko ini belum dibuat. Buat dulu dari dashboard → Stores → [toko] → Bot Config.')
    }

    const existing = data.allowed_numbers
        ? data.allowed_numbers.split(',').map((n: string) => n.trim()).filter(Boolean)
        : []

    if (existing.includes(phoneNumber)) throw new Error('already_whitelisted')

    const updated = [...existing, phoneNumber].join(',')

    const { error } = await sb
        .from('bot_config')
        .update({ allowed_numbers: updated, updated_at: new Date().toISOString() })
        .eq('id', data.id)

    if (error) throw error

    // Reload immediately so the new number works without waiting for next poll
    await loadFromSupabase()
    console.log(`[config] Whitelist updated for store ${storeId} — added: ${phoneNumber}`)
}

/**
 * Returns true if the phone number has super admin privileges
 * (can create/update stores). Sourced from SUPER_ADMIN_PHONES env var
 * and all super_admin_numbers fields in bot_config rows.
 */
export function isSuperAdmin(phone: string): boolean {
    return superAdminSet.has(phone)
}

/**
 * Build a minimal StoreBinding for a super admin that has no store context yet
 * (e.g., before they create their first store or switch to one).
 */
export function buildSuperAdminBinding(): StoreBinding {
    const defaults = buildDefaults()
    return {
        botConfigId:    '',
        storeId:        null,
        isActive:       true,
        systemPrompt:   defaults.systemPrompt,
        aiProvider:     defaults.aiProvider,
        aiModel:        defaults.aiModel,
        allowedNumbers: [],
    }
}

/** Force-reload config from Supabase immediately (e.g. after creating a store). */
export async function reloadConfig(): Promise<void> {
    await loadFromSupabase()
}

export async function startConfigPolling(intervalMs = 5 * 60 * 1000): Promise<void> {
    await loadFromSupabase()
    setInterval(() => { loadFromSupabase().catch(() => {}) }, intervalMs)
}
