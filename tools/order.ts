import { getSupabase } from '../supabase.ts'
import { getLatestBatch } from './po.ts'

function formatRupiah(amount: number): string {
    return 'Rp ' + amount.toLocaleString('id-ID')
}

async function generateInvoiceNumber(): Promise<string> {
    const sb = getSupabase()
    const { data: orders } = await sb
        .from('orders')
        .select('invoice_number')
        .order('invoice_number', { ascending: false })
        .limit(1)

    const now = new Date()
    const currentYYYYMM =
        String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, '0')

    if (!orders || orders.length === 0) {
        return currentYYYYMM + '01'
    }

    const last = orders[0].invoice_number
    const lastYYYYMM = last.slice(0, 6)
    const lastXX = parseInt(last.slice(6, 8), 10)

    if (lastYYYYMM === currentYYYYMM) {
        const next = lastXX + 1
        if (next > 99) throw new Error('Nomor invoice bulan ini sudah penuh (99 order).')
        return currentYYYYMM + String(next).padStart(2, '0')
    } else {
        return currentYYYYMM + '01'
    }
}

export interface OrderItem {
    code: string
    qty: number
}

/**
 * Parse order items from format "sourdough:2, croissant:1"
 * Returns null if format is invalid.
 */
export function parseOrderItems(raw: string): OrderItem[] | null {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
    const items: OrderItem[] = []

    for (const part of parts) {
        const colonIdx = part.lastIndexOf(':')
        if (colonIdx === -1) return null

        const code = part.slice(0, colonIdx).trim()
        const qty = parseInt(part.slice(colonIdx + 1).trim(), 10)

        if (!code || isNaN(qty) || qty <= 0) return null
        items.push({ code, qty })
    }

    return items.length > 0 ? items : null
}

export async function createOrder(
    customerName: string,
    items: OrderItem[],
    storeId?: string | null,
): Promise<string> {
    const sb = getSupabase()

    // Resolve product codes → IDs and prices
    // If storeId is set: match products for this store OR shared products (store_id IS NULL)
    type ResolvedItem = { product_id: string; name: string; code: string; price: number; quantity: number }
    const resolvedItems: ResolvedItem[] = []
    const notFound: string[] = []

    for (const item of items) {
        let query = sb
            .from('products')
            .select('id, name, code, price')
            .ilike('code', `%${item.code}%`)
            .limit(1)

        if (storeId) {
            query = query.or(`store_id.eq.${storeId},store_id.is.null`)
        }

        const { data: products } = await query

        if (!products || products.length === 0) {
            notFound.push(item.code)
        } else {
            resolvedItems.push({
                product_id: products[0].id,
                name: products[0].name,
                code: products[0].code,
                price: products[0].price,
                quantity: item.qty,
            })
        }
    }

    if (notFound.length > 0) {
        throw new Error(`Produk tidak ditemukan: *${notFound.join(', ')}*\nCek nama produk di dashboard.`)
    }

    const [batch, invoiceNumber] = await Promise.all([
        getLatestBatch(storeId),
        generateInvoiceNumber(),
    ])

    const today = new Date().toISOString().split('T')[0]

    const { data: order, error: orderError } = await sb
        .from('orders')
        .insert({
            invoice_number: invoiceNumber,
            date: today,
            customer_name: customerName.trim(),
            status: 'pending',
            po_id: batch?.id ?? null,
            store_id: storeId ?? null,
        })
        .select('id, invoice_number')
        .single()

    if (orderError) throw orderError

    const { error: itemsError } = await sb.from('order_items').insert(
        resolvedItems.map(i => ({
            order_id: order.id,
            product_id: i.product_id,
            quantity: i.quantity,
            price: i.price,
        })),
    )

    if (itemsError) throw itemsError

    const total = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
    const itemLines = resolvedItems
        .map(i => `  - ${i.name} x${i.quantity} = ${formatRupiah(i.price * i.quantity)}`)
        .join('\n')

    return (
        `✅ Order berhasil dibuat!\n\n` +
        `📋 Invoice: *${invoiceNumber}*\n` +
        `👤 ${customerName.trim()}\n` +
        (batch ? `📦 Batch: ${batch.name}\n` : '') +
        `\n${itemLines}\n\n` +
        `💰 Total: *${formatRupiah(total)}*`
    )
}

export async function getOrdersByCustomer(name: string, storeId?: string | null): Promise<string> {
    const sb = getSupabase()

    let query = sb
        .from('orders')
        .select(`
            id, invoice_number, date, status, customer_name,
            order_items ( quantity, price, products ( name ) )
        `)
        .ilike('customer_name', `%${name}%`)
        .order('created_at', { ascending: false })
        .limit(5)

    if (storeId) query = query.eq('store_id', storeId)

    const { data: orders } = await query

    if (!orders || orders.length === 0) {
        return `❌ Tidak ada pesanan dengan nama "${name}".`
    }

    const blocks = orders.map(order => {
        const items = order.order_items as { quantity: number; price: number; products: { name: string } | null }[]
        const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
        const statusIcon = order.status === 'paid' ? '✅' : '⏳'
        const itemLines = items
            .map(i => `  - ${i.products?.name ?? '?'} x${i.quantity} = ${formatRupiah(i.price * i.quantity)}`)
            .join('\n')

        return (
            `*${order.customer_name}* — ${order.invoice_number}\n` +
            `${statusIcon} ${order.status} | ${order.date}\n` +
            `${itemLines}\n` +
            `💰 Total: *${formatRupiah(total)}*`
        )
    })

    const header = orders.length > 1
        ? `Ditemukan ${orders.length} pesanan untuk "${name}":\n\n`
        : ''

    return header + blocks.join('\n\n---\n\n')
}

export async function getProductList(search?: string, readyOnly = false, storeId?: string | null): Promise<string> {
    const sb = getSupabase()

    if (readyOnly) {
        // Products opened for the latest batch — query via po_list
        const batch = await getLatestBatch(storeId)
        if (!batch) return '❌ Belum ada batch PO aktif.'

        const { data: poItems } = await sb
            .from('po_list')
            .select('products ( name, code, price )')
            .eq('po_id', batch.id)

        if (!poItems || poItems.length === 0) {
            return (
                `❌ Belum ada produk yang dibuka di batch *${batch.name}*.\n\n` +
                `Gunakan:\n/po baru ${batch.name} | SD, CR`
            )
        }

        type ProductRow = { name: string; code: string | null; price: number }
        let products = poItems
            .map(i => i.products as ProductRow | null)
            .filter((p): p is ProductRow => p !== null)

        if (search) {
            const lowerSearch = search.toLowerCase()
            products = products.filter(p =>
                p.name.toLowerCase().includes(lowerSearch) ||
                (p.code && p.code.toLowerCase().includes(lowerSearch))
            )
        }

        if (products.length === 0) return `❌ Produk "${search}" tidak ditemukan di batch *${batch.name}*.`

        const lines = products.map(p => {
            const code = p.code ? `[${p.code}]` : '[—]'
            return `${code.padEnd(8)} ${p.name} — ${formatRupiah(p.price)}`
        })

        return (
            `✅ *Produk Dibuka — ${batch.name}* (${products.length}):\n\n` +
            `\`\`\`\n${lines.join('\n')}\n\`\`\`` +
            `\n\nGunakan kode untuk order:\n/order <nama> | SD:2, CR:1`
        )
    }

    // All active products
    let query = sb
        .from('products')
        .select('name, code, price')
        .eq('is_active', true)
        .order('name')

    if (storeId) {
        query = query.or(`store_id.eq.${storeId},store_id.is.null`)
    }

    if (search) {
        query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }

    const { data: products } = await query

    if (!products || products.length === 0) {
        return search ? `❌ Produk "${search}" tidak ditemukan.` : '❌ Belum ada produk aktif.'
    }

    const lines = products.map(p => {
        const code = p.code ? `[${p.code}]` : '[—]'
        return `${code.padEnd(8)} ${p.name} — ${formatRupiah(p.price)}`
    })

    const header = search
        ? `🔍 Produk "${search}" (${products.length}):\n\n`
        : `📦 *Daftar Produk* (${products.length}):\n\n`

    return header + `\`\`\`\n${lines.join('\n')}\n\`\`\`` +
        `\n\nGunakan kode dalam bracket untuk order:\n/order <nama> | SD:2, CR:1`
}

export async function getLatestBatchResume(storeId?: string | null): Promise<string> {
    const batch = await getLatestBatch(storeId)
    if (!batch) return '❌ Belum ada batch PO yang dibuat.'

    const sb = getSupabase()

    let query = sb
        .from('orders')
        .select(`
            id, invoice_number, customer_name, status,
            order_items ( quantity, price, products ( name ) )
        `)
        .eq('po_id', batch.id)
        .order('created_at', { ascending: true })

    if (storeId) query = query.eq('store_id', storeId)

    const { data: orders } = await query

    if (!orders || orders.length === 0) {
        return `📦 Batch: *${batch.name}*\n\nBelum ada order dalam batch ini.`
    }

    const paid = orders.filter(o => o.status === 'paid').length
    const pending = orders.length - paid

    const grandTotal = orders.reduce((sum, o) => {
        const items = o.order_items as { quantity: number; price: number }[]
        return sum + items.reduce((s, i) => s + i.price * i.quantity, 0)
    }, 0)

    const orderLines = orders.map((o, idx) => {
        const items = o.order_items as { quantity: number; price: number; products: { name: string } | null }[]
        const total = items.reduce((s, i) => s + i.price * i.quantity, 0)
        const icon = o.status === 'paid' ? '✅' : '⏳'
        const itemSummary = items.map(i => `${i.products?.name ?? '?'} x${i.quantity}`).join(', ')
        return `${idx + 1}. ${icon} *${o.customer_name}* — ${itemSummary} — ${formatRupiah(total)}`
    })

    return (
        `📦 *${batch.name}*\n\n` +
        `Total: ${orders.length} order | ✅ ${paid} lunas | ⏳ ${pending} pending\n` +
        `💰 Grand Total: *${formatRupiah(grandTotal)}*\n\n` +
        orderLines.join('\n')
    )
}
