import { getSupabase } from '../supabase.ts'
import { getLatestBatch } from './po.ts'

function fmt(n: number): string {
    return 'Rp ' + n.toLocaleString('id-ID')
}

// ─── Find order ───────────────────────────────────────────────────────────────

/**
 * Find an order by customer name — searches latest batch first, then all orders.
 * Returns the most recent match.
 */
async function findOrder(customerName: string, storeId?: string | null): Promise<{
    id: string
    invoice_number: string
    customer_name: string
    batchName: string | null
} | null> {
    const sb = getSupabase()
    const batch = await getLatestBatch(storeId)

    // Try latest batch first
    if (batch) {
        let q = sb
            .from('orders')
            .select('id, invoice_number, customer_name')
            .eq('po_id', batch.id)
            .ilike('customer_name', `%${customerName}%`)
            .order('created_at', { ascending: false })
            .limit(1)

        if (storeId) q = q.eq('store_id', storeId)

        const { data } = await q.maybeSingle()
        if (data) return { ...data, batchName: batch.name }
    }

    // Fallback: search all orders (scoped to store if set)
    let q = sb
        .from('orders')
        .select('id, invoice_number, customer_name')
        .ilike('customer_name', `%${customerName}%`)
        .order('created_at', { ascending: false })
        .limit(1)

    if (storeId) q = q.eq('store_id', storeId)

    const { data } = await q.maybeSingle()
    return data ? { ...data, batchName: null } : null
}

// ─── tambah produk ────────────────────────────────────────────────────────────

/**
 * Add products to an existing order by product code.
 * If the product already exists in the order, its quantity is incremented.
 */
export async function addItemsToOrder(
    customerName: string,
    items: { code: string; qty: number }[],
    storeId?: string | null,
): Promise<string> {
    const sb = getSupabase()
    const order = await findOrder(customerName, storeId)
    if (!order) throw new Error(`Pesanan "${customerName}" tidak ditemukan.`)

    const added: string[] = []
    const notFound: string[] = []

    for (const item of items) {
        // Resolve product by code
        const { data: products } = await sb
            .from('products')
            .select('id, name, price')
            .ilike('code', item.code)
            .limit(1)

        if (!products || products.length === 0) {
            notFound.push(item.code)
            continue
        }

        const product = products[0]

        // Check if already in order
        const { data: existing } = await sb
            .from('order_items')
            .select('id, quantity')
            .eq('order_id', order.id)
            .eq('product_id', product.id)
            .maybeSingle()

        if (existing) {
            const newQty = existing.quantity + item.qty
            await sb.from('order_items').update({ quantity: newQty }).eq('id', existing.id)
            added.push(`${product.name} x${existing.quantity}→*${newQty}* (+${item.qty})`)
        } else {
            await sb.from('order_items').insert({
                order_id: order.id,
                product_id: product.id,
                quantity: item.qty,
                price: product.price,
            })
            added.push(`${product.name} x${item.qty} (baru)`)
        }
    }

    const lines: string[] = []
    if (added.length > 0) lines.push(`✅ *${order.customer_name}* — ${order.invoice_number}\n` + added.map(l => `  + ${l}`).join('\n'))
    if (notFound.length > 0) lines.push(`⚠️ Produk tidak ditemukan: ${notFound.join(', ')}`)

    return lines.join('\n\n')
}

// ─── ganti qty ────────────────────────────────────────────────────────────────

/**
 * Update quantity of a specific product in an order.
 * qty = 0 removes the item entirely.
 */
export async function updateItemQty(
    customerName: string,
    productName: string,
    qty: number,
    storeId?: string | null,
): Promise<string> {
    const sb = getSupabase()
    const order = await findOrder(customerName, storeId)
    if (!order) throw new Error(`Pesanan "${customerName}" tidak ditemukan.`)

    // Find the order_item by product name or code (join via products table)
    const { data: items } = await sb
        .from('order_items')
        .select('id, quantity, price, products ( id, name, code )')
        .eq('order_id', order.id)

    if (!items || items.length === 0) {
        throw new Error(`Order *${order.invoice_number}* tidak memiliki item.`)
    }

    type Item = typeof items[number] & { products: { id: string; name: string; code: string | null } | null }
    const lowerSearch = productName.toLowerCase()
    const match = (items as Item[]).find(i =>
        i.products?.name.toLowerCase().includes(lowerSearch) ||
        (i.products?.code && i.products.code.toLowerCase().includes(lowerSearch))
    )

    if (!match) {
        const names = (items as Item[]).map(i => i.products?.name ?? '?').join(', ')
        throw new Error(`Produk "${productName}" tidak ada di order ini.\nItem saat ini: ${names}`)
    }

    if (qty === 0) {
        await sb.from('order_items').delete().eq('id', match.id)
        return (
            `🗑️ *${match.products?.name}* dihapus dari order *${order.customer_name}* (${order.invoice_number}).`
        )
    }

    const oldQty = match.quantity
    await sb.from('order_items').update({ quantity: qty }).eq('id', match.id)

    return (
        `✅ *${order.customer_name}* — ${order.invoice_number}\n` +
        `  ${match.products?.name}: ${oldQty} → *${qty}*\n` +
        `  Harga satuan: ${fmt(match.price)}\n` +
        `  Subtotal baru: ${fmt(match.price * qty)}`
    )
}

// ─── ongkir ───────────────────────────────────────────────────────────────────

/**
 * Set or update shipping for an order.
 * If a delivery row already exists, it is updated. Otherwise a new one is inserted.
 */
// ─── batal order ─────────────────────────────────────────────────────────────

/**
 * Cancel an order by customer name.
 * - Rejected if the order is already paid.
 * - Rejected if the order is already cancelled.
 * - Sets status to 'cancelled'. Items and delivery rows are kept for audit trail.
 */
export async function cancelOrder(customerName: string, storeId?: string | null): Promise<string> {
    const sb = getSupabase()
    const order = await findOrder(customerName, storeId)
    if (!order) throw new Error(`Pesanan "${customerName}" tidak ditemukan.`)

    // Fetch current status + items for summary
    const { data: full } = await sb
        .from('orders')
        .select(`
            id, invoice_number, customer_name, status, date,
            order_items ( quantity, price, products ( name ) )
        `)
        .eq('id', order.id)
        .single()

    if (!full) throw new Error('Gagal mengambil detail order.')

    if (full.status === 'paid') {
        return (
            `⚠️ Order *${full.customer_name}* (${full.invoice_number}) sudah *LUNAS* dan tidak bisa dibatalkan.\n\n` +
            `Hubungi pemilik toko jika ada kesalahan.`
        )
    }

    if (full.status === 'cancelled') {
        return `ℹ️ Order *${full.customer_name}* (${full.invoice_number}) sudah dibatalkan sebelumnya.`
    }

    const { error } = await sb
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('id', order.id)

    if (error) throw error

    const items = full.order_items as { quantity: number; price: number; products: { name: string } | null }[]
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
    const itemLines = items
        .map(i => `  - ${i.products?.name ?? '?'} x${i.quantity} = ${fmt(i.price * i.quantity)}`)
        .join('\n')

    return (
        `❌ Order *${full.customer_name}* dibatalkan.\n\n` +
        `📋 Invoice: ${full.invoice_number} | ${full.date}\n\n` +
        `${itemLines}\n\n` +
        `💰 Total yang dibatalkan: *${fmt(total)}*`
    )
}

// ─── bayar ────────────────────────────────────────────────────────────────────

/**
 * Mark an order as paid. Supabase trigger auto-creates the financial_transaction.
 */
export async function markOrderPaid(customerName: string, storeId?: string | null): Promise<string> {
    const sb = getSupabase()
    const order = await findOrder(customerName, storeId)
    if (!order) throw new Error(`Pesanan "${customerName}" tidak ditemukan.`)

    // Fetch current status + items for summary
    const { data: full } = await sb
        .from('orders')
        .select(`
            id, invoice_number, customer_name, status,
            order_items ( quantity, price, products ( name ) ),
            deliveries ( shipping_cost )
        `)
        .eq('id', order.id)
        .single()

    if (!full) throw new Error('Gagal mengambil detail order.')

    if (full.status === 'paid') {
        return `ℹ️ Order *${full.customer_name}* (${full.invoice_number}) sudah berstatus *lunas*.`
    }

    const { error } = await sb
        .from('orders')
        .update({ status: 'paid' })
        .eq('id', order.id)

    if (error) throw error

    const items = full.order_items as { quantity: number; price: number; products: { name: string } | null }[]
    const deliveries = full.deliveries as { shipping_cost: number }[]

    const itemTotal = items.reduce((s, i) => s + i.price * i.quantity, 0)
    const shipping = deliveries.reduce((s, d) => s + (d.shipping_cost ?? 0), 0)
    const grandTotal = itemTotal + shipping

    const itemLines = items
        .map(i => `  - ${i.products?.name ?? '?'} x${i.quantity} = ${fmt(i.price * i.quantity)}`)
        .join('\n')

    return (
        `✅ *${full.customer_name}* — ${full.invoice_number}\n` +
        `Status: pending → *LUNAS*\n\n` +
        `${itemLines}\n` +
        (shipping > 0 ? `  - Ongkir = ${fmt(shipping)}\n` : '') +
        `\n💰 Total: *${fmt(grandTotal)}*`
    )
}

export async function setShipping(
    customerName: string,
    cost: number,
    courier: string | null,
    storeId?: string | null,
): Promise<string> {
    const sb = getSupabase()
    const order = await findOrder(customerName, storeId)
    if (!order) throw new Error(`Pesanan "${customerName}" tidak ditemukan.`)

    // Upsert delivery
    const { data: existing } = await sb
        .from('deliveries')
        .select('id, shipping_cost, courier_name')
        .eq('order_id', order.id)
        .limit(1)
        .maybeSingle()

    const payload = {
        order_id: order.id,
        shipping_cost: cost,
        courier_name: courier ?? existing?.courier_name ?? null,
        status: 'pending',
    }

    if (existing) {
        await sb.from('deliveries').update({
            shipping_cost: cost,
            courier_name: payload.courier_name,
        }).eq('id', existing.id)

        const oldInfo = `${fmt(existing.shipping_cost)}${existing.courier_name ? ` (${existing.courier_name})` : ''}`
        const newInfo = `${fmt(cost)}${payload.courier_name ? ` (${payload.courier_name})` : ''}`
        return (
            `✅ Ongkir *${order.customer_name}* — ${order.invoice_number}\n` +
            `  ${oldInfo} → *${newInfo}*`
        )
    } else {
        await sb.from('deliveries').insert(payload)
        const newInfo = `${fmt(cost)}${payload.courier_name ? ` (${payload.courier_name})` : ''}`
        return (
            `✅ Ongkir ditambahkan ke *${order.customer_name}* — ${order.invoice_number}\n` +
            `  ${newInfo}`
        )
    }
}
