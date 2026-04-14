import PDFDocument from 'pdfkit'
import { getSupabase } from '../supabase.ts'
import { getLatestBatch } from './po.ts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoreInfo {
    name: string
    phone: string
    logo_url: string | null
    bank_name: string | null
    bank_account: string | null
    bank_holder: string | null
    invoice_closing_message: string | null
    invoice_closing_sub: string | null
}

interface OrderData {
    invoice_number: string
    date: string
    customer_name: string
    phone: string | null
    order_items: {
        quantity: number
        price: number
        products: { name: string } | null
    }[]
    deliveries: {
        shipping_cost: number
        courier_name: string | null
    }[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return 'Rp ' + n.toLocaleString('id-ID')
}

function dateStr(isoDate: string): string {
    return new Date(isoDate + 'T00:00:00').toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchOrder(customerName: string, batchId: string, storeId?: string | null): Promise<OrderData | null> {
    const sb = getSupabase()
    let query = sb
        .from('orders')
        .select(`
            invoice_number, date, customer_name, phone,
            order_items ( quantity, price, products ( name ) ),
            deliveries ( shipping_cost, courier_name )
        `)
        .eq('po_id', batchId)
        .ilike('customer_name', `%${customerName}%`)
        .order('created_at', { ascending: false })
        .limit(1)

    if (storeId) query = query.eq('store_id', storeId)

    const { data } = await query.maybeSingle()
    return data as OrderData | null
}

async function fetchStoreInfo(storeId?: string | null): Promise<StoreInfo | null> {
    const sb = getSupabase()

    // If storeId is set, prefer store-specific details from the stores table.
    // Fall back to global store_info if not found or storeId is null.
    if (storeId) {
        const { data } = await sb
            .from('stores')
            .select('name, phone, logo_url, bank_name, bank_account, bank_holder, invoice_closing_message, invoice_closing_sub')
            .eq('id', storeId)
            .maybeSingle()

        if (data) return data as StoreInfo
    }

    const { data } = await sb
        .from('store_info')
        .select('name, phone, logo_url, bank_name, bank_account, bank_holder, invoice_closing_message, invoice_closing_sub')
        .limit(1)
        .maybeSingle()

    return data as StoreInfo | null
}

async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
    try {
        const res = await fetch(logoUrl)
        if (!res.ok) return null
        return Buffer.from(await res.arrayBuffer())
    } catch {
        return null
    }
}

// ─── PDF builder ──────────────────────────────────────────────────────────────

function buildPDF(order: OrderData, store: StoreInfo | null, logoBuffer: Buffer | null): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 0 })
        const chunks: Buffer[] = []

        doc.on('data', (c: Buffer) => chunks.push(c))
        doc.on('end', () => resolve(Buffer.concat(chunks)))
        doc.on('error', reject)

        const W = doc.page.width  // 595
        const H = doc.page.height // 842
        const L = 40              // left content boundary
        const R = W - 40          // right content boundary (555)
        const CW = R - L          // content width (515)

        // ── Watermark (logo, centered, low opacity) ───────────────────────
        if (logoBuffer) {
            try {
                // Render at 60% of page width, centered
                const logoW = W * 0.6
                const logoX = (W - logoW) / 2
                const logoY = (H - logoW) / 2  // square-ish, will auto-scale height

                doc.save()
                doc.opacity(0.12)
                doc.image(logoBuffer, logoX, logoY, { width: logoW, align: 'center', valign: 'center' })
                doc.restore()
            } catch {
                // If image fails (unsupported format), skip watermark silently
            }
        }

        // ── Column layout ─────────────────────────────────────────────────
        // Item | Qty | Price | Amount
        const COL = {
            item:   { x: L,       w: 220 },
            qty:    { x: L + 230, w: 50  },
            price:  { x: L + 290, w: 110 },
            amount: { x: L + 410, w: R - L - 410 },
        }

        // ── Helper: row of table cells ────────────────────────────────────
        function tableRow(
            y: number,
            item: string,
            qty: string,
            price: string,
            amount: string,
            bold = false,
        ) {
            const font = bold ? 'Helvetica-Bold' : 'Helvetica'
            doc.font(font).fontSize(9)
            doc.text(item,   COL.item.x,   y, { width: COL.item.w,   lineBreak: false })
            doc.text(qty,    COL.qty.x,    y, { width: COL.qty.w,    align: 'center', lineBreak: false })
            doc.text(price,  COL.price.x,  y, { width: COL.price.w,  align: 'right',  lineBreak: false })
            doc.text(amount, COL.amount.x, y, { width: COL.amount.w, align: 'right',  lineBreak: false })
        }

        // ─────────────────────────────────────────────────────────────────
        // Header
        // ─────────────────────────────────────────────────────────────────
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#111111')
        doc.text('Invoice', L, 40, { width: CW, align: 'right', lineBreak: false })

        let hy = 68
        if (store?.name) {
            doc.font('Helvetica-Bold').fontSize(13)
            doc.text(store.name, L, hy, { width: CW, align: 'right', lineBreak: false })
            hy += 16
        }
        if (store?.phone) {
            doc.font('Helvetica').fontSize(8).fillColor('#555555')
            doc.text('No HP', L, hy, { width: CW, align: 'right', lineBreak: false })
            hy += 10
            doc.text(store.phone, L, hy, { width: CW, align: 'right', lineBreak: false })
        }

        // ─────────────────────────────────────────────────────────────────
        // Bill To (left) + Invoice Details (right)
        // ─────────────────────────────────────────────────────────────────
        const billY = 115
        doc.fillColor('#111111')
        doc.font('Helvetica-Bold').fontSize(8)
        doc.text('BILL TO', L, billY, { lineBreak: false })
        doc.font('Helvetica').fontSize(11)
        doc.text(order.customer_name, L, billY + 13, { width: 200, lineBreak: false })
        if (order.phone) {
            doc.fontSize(9).text(order.phone, L, billY + 27, { lineBreak: false })
        }

        // Invoice meta (right side)
        const metaLabelX = L + 300
        const metaValueX = L + 380
        const metaValueW = R - metaValueX

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333')
        doc.text('Invoice #',  metaLabelX, billY,      { width: 75, lineBreak: false })
        doc.text('Tanggal',    metaLabelX, billY + 13, { width: 75, lineBreak: false })

        doc.font('Helvetica').fillColor('#111111')
        doc.text(order.invoice_number,  metaValueX, billY,      { width: metaValueW, lineBreak: false })
        doc.text(dateStr(order.date),   metaValueX, billY + 13, { width: metaValueW, lineBreak: false })

        // ─────────────────────────────────────────────────────────────────
        // Divider
        // ─────────────────────────────────────────────────────────────────
        doc.moveTo(L, 160).lineTo(R, 160).strokeColor('#dddddd').lineWidth(0.5).stroke()

        // ─────────────────────────────────────────────────────────────────
        // Table header
        // ─────────────────────────────────────────────────────────────────
        let y = 168
        doc.rect(L, y - 4, CW, 20).fill('#f0f0f0')
        doc.fillColor('#111111')
        tableRow(y, 'Item', 'Qty', 'Harga', 'Jumlah', true)
        y += 22

        // ─────────────────────────────────────────────────────────────────
        // Table rows
        // ─────────────────────────────────────────────────────────────────
        let subtotal = 0
        doc.fillColor('#111111')

        for (const item of order.order_items) {
            const amount = item.price * item.quantity
            subtotal += amount
            tableRow(y, item.products?.name ?? 'Unknown', String(item.quantity), fmt(item.price), fmt(amount))
            y += 17
        }

        // Shipping rows
        for (const d of order.deliveries) {
            if (d.shipping_cost > 0) {
                subtotal += d.shipping_cost
                const label = d.courier_name ? `Ongkir (${d.courier_name})` : 'Ongkir'
                tableRow(y, label, '1', fmt(d.shipping_cost), fmt(d.shipping_cost))
                y += 17
            }
        }

        // ─────────────────────────────────────────────────────────────────
        // Totals
        // ─────────────────────────────────────────────────────────────────
        y += 6
        doc.moveTo(L, y).lineTo(R, y).strokeColor('#dddddd').lineWidth(0.5).stroke()
        y += 8

        // Subtotal row
        doc.font('Helvetica').fontSize(9).fillColor('#555555')
        doc.text('Subtotal', COL.price.x, y, { width: COL.price.w, align: 'right', lineBreak: false })
        doc.fillColor('#111111')
        doc.text(fmt(subtotal), COL.amount.x, y, { width: COL.amount.w, align: 'right', lineBreak: false })
        y += 14

        // Total row
        doc.font('Helvetica-Bold').fontSize(11)
        doc.fillColor('#333333')
        doc.text('Total', COL.price.x, y, { width: COL.price.w, align: 'right', lineBreak: false })
        doc.fillColor('#111111')
        doc.text(fmt(subtotal), COL.amount.x, y, { width: COL.amount.w, align: 'right', lineBreak: false })
        y += 18

        // Amount Due box
        doc.rect(L, y, CW, 30).fill('#f0f0f0')
        doc.fillColor('#111111')
        doc.font('Helvetica-Bold').fontSize(10)
        doc.text('Amount Due', L + 8, y + 9, { lineBreak: false })
        doc.fontSize(14)
        doc.text(fmt(subtotal), COL.amount.x, y + 7, { width: COL.amount.w, align: 'right', lineBreak: false })
        y += 42

        // ─────────────────────────────────────────────────────────────────
        // Payment info / closing
        // ─────────────────────────────────────────────────────────────────
        if (store?.bank_name || store?.bank_account || store?.invoice_closing_message) {
            doc.rect(L, y, CW, 55).fill('#fafafa')
            doc.fillColor('#333333')
            let py = y + 8

            if (store.bank_name || store.bank_account) {
                doc.font('Helvetica-Bold').fontSize(8)
                doc.text('Silahkan transfer ke rekening berikut :', L + 8, py, { lineBreak: false })
                py += 12

                const bankLine = [
                    store.bank_name,
                    store.bank_account,
                    store.bank_holder ? `a.n ${store.bank_holder}` : null,
                ]
                    .filter(Boolean)
                    .join(' : ')

                doc.font('Helvetica').text(`• ${bankLine}`, L + 8, py, { width: CW - 16, lineBreak: false })
                py += 14
            }

            if (store.invoice_closing_message) {
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111')
                doc.text(store.invoice_closing_message, L + 8, py, { width: CW - 16, lineBreak: false })
                py += 12
            }

            if (store.invoice_closing_sub) {
                doc.font('Helvetica').fontSize(8).fillColor('#555555')
                doc.text(store.invoice_closing_sub, L + 8, py, { width: CW - 16, lineBreak: false })
            }
        }

        doc.end()
    })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InvoicePDF {
    buffer: Buffer
    fileName: string
    customerName: string
    invoiceNumber: string
}

export async function generateInvoicePDF(customerName: string, storeId?: string | null): Promise<InvoicePDF> {
    const batch = await getLatestBatch(storeId)
    if (!batch) throw new Error('Belum ada batch PO yang dibuat.')

    const [order, store] = await Promise.all([
        fetchOrder(customerName, batch.id, storeId),
        fetchStoreInfo(storeId),
    ])

    if (!order) {
        throw new Error(
            `Pesanan "${customerName}" tidak ditemukan di batch *${batch.name}*.\n` +
            `Coba /cari ${customerName} untuk memastikan nama yang benar.`
        )
    }

    // Fetch logo for watermark from stores table (non-blocking — invoice still works without it)
    const logoBuffer = store?.logo_url ? await fetchLogoBuffer(store.logo_url) : null

    const buffer = await buildPDF(order, store, logoBuffer)
    const safeName = order.customer_name.replace(/\s+/g, '_')
    const fileName = `Invoice-${order.invoice_number}-${safeName}.pdf`

    return {
        buffer,
        fileName,
        customerName: order.customer_name,
        invoiceNumber: order.invoice_number,
    }
}
