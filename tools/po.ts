import { getSupabase } from '../supabase.ts'

function fmt(n: number): string {
    return 'Rp ' + n.toLocaleString('id-ID')
}

export interface Batch {
    id: string
    name: string
    created_at: string
}

/**
 * Create a new batch PO.
 * If readyCodes is provided, set is_ready=true for those products and false for all others.
 * readyCodes: array of product codes (case-insensitive)
 */
export async function createBatchPO(name: string, readyCodes?: string[], storeId?: string | null): Promise<string> {
    const sb = getSupabase()
    const { data, error } = await sb
        .from('batch_po')
        .insert({ name: name.trim(), store_id: storeId ?? null })
        .select('id, name')
        .single()

    if (error) {
        if (error.code === '23505') throw new Error(`Batch "${name.trim()}" sudah ada.`)
        throw error
    }

    if (!readyCodes || readyCodes.length === 0) {
        return `✅ Batch PO *${data.name}* berhasil dibuat.\n\nℹ️ Belum ada produk yang dibuka. Gunakan /po baru <nama> | SD, CR untuk set produk.`
    }

    // Fetch active products that match the provided codes
    const lowerCodes = readyCodes.map(c => c.toLowerCase())

    const { data: allProducts } = await sb
        .from('products')
        .select('id, name, code')
        .eq('is_active', true)

    if (!allProducts || allProducts.length === 0) {
        return `✅ Batch PO *${data.name}* berhasil dibuat.\n\n⚠️ Tidak ada produk aktif ditemukan.`
    }

    const matched: { id: string; name: string; code: string | null }[] = []
    const notFound: string[] = []

    for (const code of readyCodes) {
        const product = allProducts.find(p => p.code?.toLowerCase() === code.toLowerCase())
        if (product) {
            matched.push(product)
        } else {
            notFound.push(code)
        }
    }

    // Insert matched products into po_list
    if (matched.length > 0) {
        const { error: listError } = await sb.from('po_list').insert(
            matched.map(p => ({ po_id: data.id, product_id: p.id }))
        )
        if (listError) throw listError
    }

    const readyList = matched
        .map(p => `  ✅ ${p.code ? `[${p.code}]` : ''} ${p.name}`.trim())
        .join('\n')

    const notFoundWarn = notFound.length > 0
        ? `\n\n⚠️ Kode tidak ditemukan: *${notFound.join(', ')}*`
        : ''

    return (
        `✅ Batch PO *${data.name}* berhasil dibuat.\n\n` +
        `*Produk dibuka (${matched.length}):*\n${readyList}` +
        notFoundWarn
    )
}

export async function getLatestBatch(storeId?: string | null): Promise<Batch | null> {
    const sb = getSupabase()
    let query = sb
        .from('batch_po')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(1)

    if (storeId) query = query.eq('store_id', storeId)

    const { data } = await query.maybeSingle()
    return data
}

// ─── PO form (multi-step flow) ────────────────────────────────────────────────

export interface POFormProduct {
    code: string
    name: string
    price: number
}

export interface POFormResult {
    batchName: string
    codes: string[]  // product codes to open; empty = create batch without opening any
}

/**
 * Fetch all active products to populate the PO form.
 */
export async function getProductsForPOForm(storeId?: string | null): Promise<POFormProduct[]> {
    const sb = getSupabase()

    let query = sb
        .from('products')
        .select('name, code, price')
        .eq('is_active', true)
        .not('code', 'is', null)
        .order('name')
        .limit(50)

    if (storeId) query = query.or(`store_id.eq.${storeId},store_id.is.null`)

    const { data } = await query
    return (data ?? [])
        .filter(p => p.code)
        .map(p => ({ code: p.code!, name: p.name, price: p.price }))
}

/**
 * Generate the PO form template to send to the user.
 */
export function buildPOFormTemplate(products: POFormProduct[], storeName?: string | null): string {
    const productLines = products
        .map(p => `${p.code} | ${p.name} | ${fmt(p.price)} | `)
        .join('\n')

    return (
        `📋 *Form Batch PO Baru${storeName ? ` — ${storeName}` : ''}*\n\n` +
        `Nama Batch: \n\n` +
        `*— Buka Produk —*\n` +
        `_(isi ✓ di kolom terakhir untuk membuka produk di batch ini)_\n\n` +
        productLines +
        `\n\n_(ketik /batal untuk membatalkan)_`
    )
}

/**
 * Parse a filled PO form.
 * Returns null if Nama Batch is missing.
 */
export function parsePOForm(text: string, products: POFormProduct[]): POFormResult | null {
    const lines = text.split('\n').map(l => l.trim())
    const lower = lines.map(l => l.toLowerCase())

    // Extract batch name
    const namaIdx = lower.findIndex(l => l.startsWith('nama batch:'))
    if (namaIdx === -1) return null
    const batchName = lines[namaIdx].slice(lines[namaIdx].indexOf(':') + 1).trim()
    if (!batchName) return null

    // Extract opened products — any non-empty last column marks the product as open
    const validCodes = new Set(products.map(p => p.code.toLowerCase()))
    const codes: string[] = []

    for (const line of lines) {
        if (!line.includes('|')) continue
        const parts = line.split('|').map(p => p.trim())
        if (parts.length < 2) continue

        const code = parts[0].toUpperCase()
        if (!validCodes.has(code.toLowerCase())) continue

        const marker = parts[parts.length - 1]
        if (marker !== '') codes.push(code)
    }

    return { batchName, codes }
}
