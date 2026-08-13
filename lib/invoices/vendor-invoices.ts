import 'server-only'

import { BUILDER_BILLING_PRICES } from '@/lib/billing/builder-billing'
import { sendResendEmail } from '@/lib/email'
import { getAppBaseUrl } from '@/lib/stripe/connect'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'

export type InvoiceLineItem = {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export type VendorInvoice = {
  id: string
  booking_id: string
  vendor_id: string
  event_id: string
  builder_id: string
  invoice_number: string
  line_items: InvoiceLineItem[]
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  deposit_amount: number
  deposit_due_date: string | null
  deposit_paid: boolean
  deposit_paid_at: string | null
  final_amount: number
  final_due_date: string | null
  final_paid: boolean
  final_paid_at: string | null
  status: InvoiceStatus
  pdf_url: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export type InvoiceContext = {
  invoice: VendorInvoice
  vendor: Record<string, any>
  event: Record<string, any>
  builder: Record<string, any>
  builderEmail?: string | null
  venue?: Record<string, any> | null
}

const PDF_ESCAPE_PATTERN = /[\\()]/g

export function toMoney(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

export function formatDate(value?: string | null) {
  if (!value) return 'TBD'
  const normalized = value.includes('T') ? value : `${value}T00:00:00`
  return new Date(normalized).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapePdfText(value: unknown) {
  return String(value ?? '').replace(PDF_ESCAPE_PATTERN, '\\$&')
}

function addDays(value: string | null | undefined, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function subtractDays(value: string | null | undefined, days: number) {
  return addDays(value, -days)
}

export function getInvoiceTaxRate() {
  const parsed = Number(process.env.INVOICE_TAX_RATE_PERCENTAGE || 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function calculateInvoiceTotals(lineItems: InvoiceLineItem[], taxRate: number) {
  const subtotal = roundMoney(lineItems.reduce((sum, item) => sum + item.total, 0))
  const taxAmount = roundMoney(subtotal * (taxRate / 100))
  const total = roundMoney(subtotal + taxAmount)
  return { subtotal, taxAmount, total }
}

export function normalizeLineItems(items: unknown): InvoiceLineItem[] {
  if (!Array.isArray(items)) return []

  return items
    .map((item) => {
      const row = item as Record<string, unknown>
      const quantity = Math.max(toMoney(row.quantity as any) || 1, 0)
      const unitPrice = Math.max(toMoney(row.unit_price as any), 0)
      const total = roundMoney(toMoney(row.total as any) || quantity * unitPrice)

      return {
        description: String(row.description || 'Service'),
        quantity,
        unit_price: unitPrice,
        total,
      }
    })
    .filter((item) => item.description && item.total >= 0)
}

export function buildDefaultLineItems(booking: Record<string, any>, service?: Record<string, any> | null, pkg?: Record<string, any> | null) {
  const amount =
    toMoney(booking.final_price) ||
    toMoney(booking.quoted_price) ||
    toMoney(service?.base_price) ||
    toMoney(pkg?.base_price) ||
    toMoney(pkg?.price)

  const serviceName = service?.offering_name || pkg?.package_name || 'Vendor services'
  const duration = service?.duration_hours || pkg?.duration_hours
  const description = duration ? `${serviceName} (${duration} hours)` : serviceName

  return [
    {
      description,
      quantity: 1,
      unit_price: roundMoney(amount),
      total: roundMoney(amount),
    },
  ]
}

/**
 * Returns the builder platform fee shown on invoices.
 *
 * Pro builders pay no per-booking platform fee; pay-per-event builders see
 * the configured booking fee as a separate line item.
 *
 * @param admin - Supabase service-role client.
 * @param builderId - Builder profile id for the booking event.
 * @returns Platform fee context for invoice line items.
 */
export async function getBuilderPlatformFeeForInvoice(admin: any, builderId: string) {
  const { data: subscription } = await admin
    .from('builder_subscriptions')
    .select('plan_type, status')
    .eq('builder_id', builderId)
    .maybeSingle()

  const isPro =
    subscription?.status === 'active' &&
    (subscription.plan_type === 'pro_monthly' || subscription.plan_type === 'pro_annual')

  return {
    isPro,
    amount: isPro ? 0 : BUILDER_BILLING_PRICES.payPerEventAmount,
  }
}

/**
 * Builds the vendor service fee and builder platform fee invoice lines.
 *
 * @param params - Booking/service/package rows plus platform fee context.
 * @returns Invoice line items.
 */
export function buildInvoiceLineItemsWithPlatformFee(params: {
  booking: Record<string, any>
  service?: Record<string, any> | null
  pkg?: Record<string, any> | null
  platformFee: number
  isPro: boolean
}) {
  return [
    ...buildDefaultLineItems(params.booking, params.service, params.pkg),
    {
      description: params.isPro ? '3rdPlace Booking Fee (Pro - Free)' : '3rdPlace Booking Fee',
      quantity: 1,
      unit_price: roundMoney(params.platformFee),
      total: roundMoney(params.platformFee),
    },
  ]
}

export function getInvoiceStatus(params: {
  depositPaid: boolean
  finalPaid: boolean
  sentAt?: string | null
  finalDueDate?: string | null
}): InvoiceStatus {
  if (params.finalPaid) return 'paid'
  if (params.finalDueDate && params.finalDueDate < new Date().toISOString().slice(0, 10)) return 'overdue'
  if (params.sentAt) return 'sent'
  return 'draft'
}

export async function getAuthenticatedVendorProfile(supabase: any, vendorId?: string | null) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { user: null, vendor: null, error: 'Unauthorized', status: 401 }
  }

  let query = supabase
    .from('vendor_profiles')
    .select('id, user_id, name, phone, service_type, regions_served, service_area, deposit_terms, deposit_refundable, default_tax_rate')
    .eq('user_id', user.id)

  if (vendorId) query = query.eq('id', vendorId)

  const { data: vendor, error } = await query.maybeSingle()

  if (error || !vendor) {
    return { user, vendor: null, error: 'Vendor profile not found', status: 404 }
  }

  return { user, vendor: vendor as Record<string, any>, error: null, status: 200 }
}

export async function getInvoiceContext(admin: any, invoiceId: string) {
  const { data: invoice, error: invoiceError } = await admin
    .from('vendor_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle()

  if (invoiceError) throw new Error(invoiceError.message)
  if (!invoice) return null

  const row = invoice as VendorInvoice
  const [vendorResult, eventResult, builderResult] = await Promise.all([
    admin
      .from('vendor_profiles')
      .select('id, user_id, name, phone, service_type, regions_served, service_area, deposit_terms, deposit_refundable, default_tax_rate')
      .eq('id', row.vendor_id)
      .maybeSingle(),
    admin
      .from('events')
      .select('id, event_name, description, event_description, event_date, start_time, end_time, builder_id, venue_id')
      .eq('id', row.event_id)
      .maybeSingle(),
    admin
      .from('builder_profiles')
      .select('id, user_id, name, phone')
      .eq('id', row.builder_id)
      .maybeSingle(),
  ])

  if (vendorResult.error) throw new Error(vendorResult.error.message)
  if (eventResult.error) throw new Error(eventResult.error.message)
  if (builderResult.error) throw new Error(builderResult.error.message)

  let builderEmail: string | null = null
  if (builderResult.data?.user_id) {
    const { data: userRow } = await admin
      .from('users')
      .select('email')
      .eq('id', builderResult.data.user_id)
      .maybeSingle()
    builderEmail = userRow?.email || null
  }

  let venue: Record<string, any> | null = null
  if (eventResult.data?.venue_id) {
    const { data: venueRow } = await admin
      .from('venues')
      .select('id, venue_name, address, city, state, zip_code')
      .eq('id', eventResult.data.venue_id)
      .maybeSingle()
    venue = venueRow
      ? {
          ...venueRow,
          name: venueRow.venue_name,
        }
      : null
  }

  return {
    invoice: {
      ...row,
      line_items: normalizeLineItems(row.line_items),
    },
    vendor: vendorResult.data || {},
    event: eventResult.data || {},
    builder: builderResult.data || {},
    builderEmail,
    venue,
  } as InvoiceContext
}

export function renderInvoiceHtml(context: InvoiceContext) {
  const { invoice, vendor, event, builder, builderEmail, venue } = context
  const lineItems = normalizeLineItems(invoice.line_items)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(invoice.invoice_number)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #172033; background: #f8fafc; }
    .invoice { max-width: 860px; margin: 0 auto; background: #ffffff; min-height: 100vh; }
    .header { background: #2d3748; color: #ffffff; padding: 28px 36px; display: flex; justify-content: space-between; gap: 24px; }
    h1 { margin: 0; font-size: 32px; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 16px; color: #1f2937; }
    p { margin: 4px 0; }
    .muted { color: #64748b; }
    .content { padding: 32px 36px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-bottom: 28px; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { text-align: left; color: #475569; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding: 10px 8px; }
    td { border-bottom: 1px solid #e2e8f0; padding: 12px 8px; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: 320px; margin-top: 22px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .grand { font-size: 20px; font-weight: 700; color: #111827; }
    .schedule { margin-top: 28px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .terms { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 18px; }
    .status { display: inline-block; border-radius: 6px; padding: 4px 8px; background: #ecfdf5; color: #047857; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div>
        <h1>INVOICE</h1>
        <p>${escapeHtml(invoice.invoice_number)}</p>
        <p>Date: ${escapeHtml(formatDate(invoice.created_at))}</p>
      </div>
      <div style="text-align:right">
        <p class="status">${escapeHtml(invoice.status)}</p>
        <p style="margin-top:12px">${escapeHtml(vendor.name || '3rdPlace Vendor')}</p>
        <p>${escapeHtml(vendor.phone || '')}</p>
      </div>
    </div>
    <div class="content">
      <div class="grid">
        <div class="box">
          <h2>Vendor</h2>
          <p><strong>${escapeHtml(vendor.name || 'Vendor')}</strong></p>
          <p>${escapeHtml(vendor.service_type || vendor.regions_served || '')}</p>
          <p>${escapeHtml(vendor.service_area || '')}</p>
        </div>
        <div class="box">
          <h2>Bill To</h2>
          <p><strong>${escapeHtml(builder.name || 'Client')}</strong></p>
          <p>${escapeHtml(builderEmail || '')}</p>
          <p>${escapeHtml(event.event_name || 'Event')}</p>
          <p>${escapeHtml(venue?.name || '')}${venue?.city ? `, ${escapeHtml(venue.city)}` : ''}${venue?.state ? `, ${escapeHtml(venue.state)}` : ''}</p>
        </div>
      </div>

      <h2>Line Items</h2>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${lineItems.map((item) => `
            <tr>
              <td>${escapeHtml(item.description)}</td>
              <td class="num">${escapeHtml(item.quantity)}</td>
              <td class="num">${escapeHtml(formatCurrency(item.unit_price))}</td>
              <td class="num">${escapeHtml(formatCurrency(item.total))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totals">
        <div class="total-row"><span>Subtotal</span><strong>${escapeHtml(formatCurrency(invoice.subtotal))}</strong></div>
        <div class="total-row"><span>Tax (${escapeHtml(invoice.tax_rate)}%)</span><strong>${escapeHtml(formatCurrency(invoice.tax_amount))}</strong></div>
        <div class="total-row grand"><span>Total</span><span>${escapeHtml(formatCurrency(invoice.total))}</span></div>
      </div>

      <div class="schedule">
        <div class="box">
          <h2>Deposit</h2>
          <p><strong>${escapeHtml(formatCurrency(invoice.deposit_amount))}</strong></p>
          <p class="muted">Due: ${escapeHtml(formatDate(invoice.deposit_due_date))}</p>
          <p>${invoice.deposit_paid ? 'Paid' : 'Pending'}</p>
        </div>
        <div class="box">
          <h2>Balance</h2>
          <p><strong>${escapeHtml(formatCurrency(invoice.final_amount))}</strong></p>
          <p class="muted">Due: ${escapeHtml(formatDate(invoice.final_due_date))}</p>
          <p>${invoice.final_paid ? 'Paid' : 'Pending'}</p>
        </div>
      </div>

      <div class="terms">
        <h2>Payment Terms</h2>
        <p>${escapeHtml(vendor.deposit_terms || 'Payment is due according to the schedule above.')}</p>
      </div>
    </div>
  </div>
</body>
</html>`
}

export function buildInvoiceEmailHtml(context: InvoiceContext, invoiceUrl: string) {
  const { invoice, vendor, event } = context
  return `
    <p>Hello,</p>
    <p>${escapeHtml(vendor.name || 'Your vendor')} sent invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> for ${escapeHtml(event.event_name || 'your event')}.</p>
    <p>Total due: <strong>${escapeHtml(formatCurrency(invoice.total))}</strong></p>
    <p><a href="${escapeHtml(invoiceUrl)}">View or download the invoice</a></p>
  `
}

export function renderInvoicePdf(context: InvoiceContext) {
  const { invoice, vendor, event, builder, builderEmail, venue } = context
  const lineItems = normalizeLineItems(invoice.line_items)
  const lines = [
    'INVOICE',
    invoice.invoice_number,
    `Date: ${formatDate(invoice.created_at)}`,
    '',
    `Vendor: ${vendor.name || 'Vendor'}`,
    `Bill To: ${builder.name || 'Client'} ${builderEmail ? `<${builderEmail}>` : ''}`,
    `Event: ${event.event_name || 'Event'}`,
    venue?.name ? `Venue: ${venue.name}${venue.city ? `, ${venue.city}` : ''}${venue.state ? `, ${venue.state}` : ''}` : '',
    '',
    'Line Items',
    ...lineItems.map((item) => `${item.description} | Qty ${item.quantity} | ${formatCurrency(item.unit_price)} | ${formatCurrency(item.total)}`),
    '',
    `Subtotal: ${formatCurrency(invoice.subtotal)}`,
    `Tax (${invoice.tax_rate}%): ${formatCurrency(invoice.tax_amount)}`,
    `Total: ${formatCurrency(invoice.total)}`,
    '',
    `Deposit Due: ${formatCurrency(invoice.deposit_amount)} (${formatDate(invoice.deposit_due_date)}) ${invoice.deposit_paid ? 'PAID' : 'PENDING'}`,
    `Balance Due: ${formatCurrency(invoice.final_amount)} (${formatDate(invoice.final_due_date)}) ${invoice.final_paid ? 'PAID' : 'PENDING'}`,
    '',
    'Payment Terms',
    vendor.deposit_terms || 'Payment is due according to the schedule above.',
  ].filter(Boolean)

  const textCommands = lines
    .flatMap((line, index) => {
      const y = 760 - index * 18
      if (y < 48) return []
      const fontSize = index === 0 ? 24 : index === 1 ? 14 : 10
      return [`BT /F1 ${fontSize} Tf 48 ${y} Td (${escapePdfText(line)}) Tj ET`]
    })
    .join('\n')

  const content = `${textCommands}\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}endstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(pdf, 'utf8')
}

export async function generateInvoiceFromBooking(params: {
  admin: any
  bookingId: string
  lineItems?: InvoiceLineItem[]
  taxRate?: number
  depositDueDate?: string
  finalDueDate?: string
  request: Request
}) {
  const { admin, bookingId, request } = params
  const { data: booking, error: bookingError } = await admin
    .from('vendor_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(bookingError.message)
  if (!booking) throw new Error('Booking not found')

  const [vendorResult, eventResult, serviceResult, packageResult] = await Promise.all([
    admin
      .from('vendor_profiles')
      .select('id, user_id, name, phone, service_type, regions_served, service_area, deposit_terms, deposit_refundable, default_tax_rate')
      .eq('id', booking.vendor_id)
      .maybeSingle(),
    admin
      .from('events')
      .select('id, event_name, description, event_description, event_date, start_time, end_time, builder_id, venue_id')
      .eq('id', booking.event_id)
      .maybeSingle(),
    booking.vendor_offering_id
      ? admin.from('vendor_offerings').select('*').eq('id', booking.vendor_offering_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    booking.vendor_package_id
      ? admin.from('vendor_packages').select('*').eq('id', booking.vendor_package_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (vendorResult.error) throw new Error(vendorResult.error.message)
  if (eventResult.error) throw new Error(eventResult.error.message)
  if (!vendorResult.data) throw new Error('Vendor profile not found')
  if (!eventResult.data) throw new Error('Event not found')

  const platformFee = await getBuilderPlatformFeeForInvoice(admin, eventResult.data.builder_id)
  const lineItems = params.lineItems?.length
    ? params.lineItems
    : buildInvoiceLineItemsWithPlatformFee({
        booking,
        service: serviceResult.data,
        pkg: packageResult.data,
        platformFee: platformFee.amount,
        isPro: platformFee.isPro,
      })
  const vendorTaxRate = vendorResult.data.default_tax_rate == null ? null : toMoney(vendorResult.data.default_tax_rate)
  const taxRate = params.taxRate ?? vendorTaxRate ?? getInvoiceTaxRate()
  const totals = calculateInvoiceTotals(lineItems, taxRate)
  const depositAmount = roundMoney(Math.min(toMoney(booking.deposit_amount), totals.total))
  const finalAmount = roundMoney(Math.max(totals.total - depositAmount, 0))
  const { data: depositTransaction } = await admin
    .from('vendor_transactions')
    .select('paid_at')
    .eq('booking_id', booking.id)
    .eq('payment_type', 'deposit')
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
  const { data: finalTransaction } = await admin
    .from('vendor_transactions')
    .select('paid_at')
    .eq('booking_id', booking.id)
    .eq('payment_type', 'final_payment')
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)

  const invoiceYear = new Date().getFullYear()
  const { data: invoiceNumber, error: invoiceNumberError } = await admin.rpc('next_vendor_invoice_number', {
    p_year: invoiceYear,
  })

  if (invoiceNumberError) throw new Error(invoiceNumberError.message)

  const finalDueDate =
    params.finalDueDate ||
    subtractDays(booking.confirmed_date || booking.requested_date || booking.booking_date || eventResult.data.event_date, 1)
  const depositDueDate = params.depositDueDate || new Date().toISOString().slice(0, 10)
  const finalPaid = booking.payment_status === 'fully_paid'
  const baseUrl = getAppBaseUrl(request)

  const { data: invoice, error: insertError } = await admin
    .from('vendor_invoices')
    .insert({
      booking_id: booking.id,
      vendor_id: booking.vendor_id,
      event_id: booking.event_id,
      builder_id: eventResult.data.builder_id,
      invoice_number: invoiceNumber,
      line_items: lineItems,
      subtotal: totals.subtotal,
      tax_rate: taxRate,
      tax_amount: totals.taxAmount,
      total: totals.total,
      deposit_amount: depositAmount,
      deposit_due_date: depositDueDate,
      deposit_paid: Boolean(booking.deposit_paid),
      deposit_paid_at: depositTransaction?.[0]?.paid_at || null,
      final_amount: finalAmount,
      final_due_date: finalDueDate,
      final_paid: finalPaid,
      final_paid_at: finalPaid ? finalTransaction?.[0]?.paid_at || booking.paid_at || null : null,
      status: getInvoiceStatus({ depositPaid: Boolean(booking.deposit_paid), finalPaid, finalDueDate }),
      pdf_url: `${baseUrl}/api/vendor/invoices/{id}/pdf`,
    })
    .select('*')
    .single()

  if (insertError) throw new Error(insertError.message)

  await admin
    .from('vendor_invoices')
    .update({ pdf_url: `${baseUrl}/api/vendor/invoices/${invoice.id}/pdf` })
    .eq('id', invoice.id)

  return invoice as VendorInvoice
}

/**
 * Uploads an invoice PDF to the public invoices storage bucket.
 *
 * @param admin - Supabase service-role client.
 * @param invoice - Invoice row used for the file name.
 * @param pdf - Rendered PDF content.
 * @returns Public URL for the stored PDF.
 */
export async function uploadInvoicePdf(admin: any, invoice: Pick<VendorInvoice, 'invoice_number'>, pdf: Buffer) {
  const fileName = `${invoice.invoice_number}.pdf`
  const { error: uploadError } = await admin.storage
    .from('invoices')
    .upload(fileName, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Failed to upload invoice PDF: ${uploadError.message}`)
  }

  const { data } = admin.storage.from('invoices').getPublicUrl(fileName)
  return data.publicUrl as string
}

/**
 * Renders invoice PDF bytes with the native renderer used by download and email routes.
 *
 * @param context - Invoice context for PDF rendering.
 * @returns PDF buffer.
 */
export function renderInvoicePdfBuffer(context: InvoiceContext) {
  return renderInvoicePdf(context)
}

/**
 * Renders and stores an invoice PDF, then updates the invoice row with its URL.
 *
 * @param admin - Supabase service-role client.
 * @param invoiceId - Invoice id to render and update.
 * @returns Updated invoice, public PDF URL, PDF bytes, and render context.
 */
export async function renderAndStoreInvoicePdf(admin: any, invoiceId: string) {
  const context = await getInvoiceContext(admin, invoiceId)
  if (!context) throw new Error('Invoice not found')

  const pdf = await renderInvoicePdfBuffer(context)
  const pdfUrl = await uploadInvoicePdf(admin, context.invoice, pdf)
  const now = new Date().toISOString()
  const { data: invoice, error } = await admin
    .from('vendor_invoices')
    .update({
      pdf_url: pdfUrl,
      status: context.invoice.final_paid ? 'paid' : 'sent',
      sent_at: now,
      updated_at: now,
    })
    .eq('id', invoiceId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  return {
    invoice: invoice as VendorInvoice,
    pdfUrl,
    pdf,
    context: {
      ...context,
      invoice: {
        ...context.invoice,
        ...invoice,
        line_items: normalizeLineItems(invoice.line_items),
      },
    } as InvoiceContext,
  }
}

export async function ensureInvoiceForBooking(params: {
  admin: any
  bookingId: string
  request: Request
}) {
  const { data: existing, error } = await params.admin
    .from('vendor_invoices')
    .select('*')
    .eq('booking_id', params.bookingId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  if (existing?.[0]) return existing[0] as VendorInvoice

  return generateInvoiceFromBooking(params)
}

export async function sendInvoiceEmail(params: {
  to: string
  subject: string
  html: string
  attachment?: {
    filename: string
    content: Buffer
    type: string
  }
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.INVOICE_FROM_EMAIL || process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    return {
      sent: false,
      reason: 'Email provider is not configured. Set RESEND_API_KEY and INVOICE_FROM_EMAIL.',
    }
  }

  const result = await sendResendEmail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachment
      ? [
          {
            filename: params.attachment.filename,
            content: params.attachment.content,
          },
        ]
      : undefined,
  })

  return { sent: result.sent, reason: result.reason }
}
