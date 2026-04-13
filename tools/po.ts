import { getSupabase } from '../supabase.ts'

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
