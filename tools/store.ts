import { getSupabase } from '../supabase.ts'
import { v2 as cloudinary } from 'cloudinary'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoreFormData {
    name: string
    phone: string | null
    bank_name: string | null
    bank_account: string | null
    bank_holder: string | null
    invoice_closing_message: string | null
    invoice_prefix: string | null
}

// ─── Form template ────────────────────────────────────────────────────────────

export const STORE_FORM_TEMPLATE =
    `Nama Toko: \n` +
    `No. Telepon: \n` +
    `Nama Bank: \n` +
    `No. Rekening: \n` +
    `Atas Nama: \n` +
    `Pesan Penutup Invoice: \n` +
    `Kode Invoice: `

// ─── Form parser ──────────────────────────────────────────────────────────────

function parseField(lines: string[], prefix: string): string | null {
    const lower = prefix.toLowerCase()
    const line = lines.find(l => l.toLowerCase().startsWith(lower))
    if (!line) return null
    const val = line.slice(prefix.length).trim()
    return val || null
}

/**
 * Parse a filled store form. Returns null if the required "Nama Toko" field
 * is missing or empty.
 */
export function parseStoreForm(text: string): StoreFormData | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    const name = parseField(lines, 'Nama Toko:')
    if (!name) return null

    const rawPrefix = parseField(lines, 'Kode Invoice:')

    return {
        name,
        phone:                   parseField(lines, 'No. Telepon:'),
        bank_name:               parseField(lines, 'Nama Bank:'),
        bank_account:            parseField(lines, 'No. Rekening:'),
        bank_holder:             parseField(lines, 'Atas Nama:'),
        invoice_closing_message: parseField(lines, 'Pesan Penutup Invoice:'),
        invoice_prefix:          rawPrefix ? rawPrefix.toUpperCase() : null,
    }
}

// ─── Create store ─────────────────────────────────────────────────────────────

/**
 * Insert a new store row and automatically create a bot_config for it.
 * creatorPhone is added to both allowed_numbers and super_admin_numbers of the new bot_config.
 * Returns the new store's UUID.
 */
export async function createStore(data: StoreFormData, creatorPhone?: string): Promise<string> {
    const sb = getSupabase()

    const { data: store, error } = await sb
        .from('stores')
        .insert({
            name:                    data.name,
            phone:                   data.phone,
            bank_name:               data.bank_name,
            bank_account:            data.bank_account,
            bank_holder:             data.bank_holder,
            invoice_closing_message: data.invoice_closing_message || 'Terima Kasih',
            invoice_prefix:          data.invoice_prefix,
            is_active:               true,
        })
        .select('id')
        .single()

    if (error) throw new Error('Gagal membuat toko: ' + error.message)

    // Auto-create bot_config for the new store
    await createBotConfigForStore(store.id, creatorPhone)

    return store.id
}

/**
 * Create a default bot_config row for a newly created store.
 * The creator's phone number is added to allowed_numbers and super_admin_numbers.
 */
async function createBotConfigForStore(storeId: string, creatorPhone?: string): Promise<void> {
    const sb = getSupabase()
    const phones = creatorPhone ? creatorPhone : ''

    const { error } = await sb.from('bot_config').insert({
        store_id:             storeId,
        is_active:            true,
        allowed_numbers:      phones,
        super_admin_numbers:  phones,
        system_prompt:        '',
        ai_provider:          process.env.AI_PROVIDER || 'openrouter',
        ai_model:             process.env.OPENROUTER_MODEL || process.env.CLAUDE_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
    })

    if (error) {
        // Non-fatal: store was created, bot_config can be set up from dashboard
        console.warn('[store] Could not auto-create bot_config:', error.message)
    }
}

// ─── Upload logo to Cloudinary ────────────────────────────────────────────────

/**
 * Upload an image buffer to Cloudinary and return the secure URL.
 */
export async function uploadLogoToCloudinary(
    buffer: Buffer,
    storeName: string,
): Promise<string> {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    })

    const publicId = `store-logos/${storeName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { public_id: publicId, resource_type: 'image' },
            (err, result) => {
                if (err || !result) {
                    reject(new Error('Upload Cloudinary gagal: ' + (err?.message ?? 'unknown')))
                    return
                }
                resolve(result.secure_url)
            },
        )
        stream.end(buffer)
    })
}

// ─── Update store logo ────────────────────────────────────────────────────────

export async function updateStoreLogo(storeId: string, logoUrl: string): Promise<void> {
    const sb = getSupabase()
    const { error } = await sb
        .from('stores')
        .update({ logo_url: logoUrl })
        .eq('id', storeId)

    if (error) throw new Error('Gagal update logo: ' + error.message)
}
