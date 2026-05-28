export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  DOCUMENT_EXTRACTION_ALLOWED_MIME_TYPES,
  runDocumentExtractionAgent,
  type DocumentExtractionOutput,
} from '@/lib/ai/agents/documentExtractionAgent'
import { dollarsToCents, readCents } from '@/lib/money'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const SPEND_REPORT_BUCKET = 'venue-spend-reports'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const revenueOverrideSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'string') return Number(value)
    return value
  },
  z.number().int().nonnegative().nullable()
)

type VenueDb = { from: (table: string) => any }

type KickbackAgreementRow = {
  id: string
  event_id: string | null
  plan_id?: string | null
  venue_id: string
  venue_owner_id: string
  builder_id: string
  actual_attendance: number | null
  per_head_amount: number | string | null
  lift_share_percentage: number | string | null
  baseline_sales: number | string | null
  actual_sales: number | string | null
  bar_revenue_share_percent?: number | string | null
  ticket_revenue_share_percent?: number | string | null
}

type ExistingPaymentRow = {
  id: string
  status: string
}

type UploadedProof = {
  path: string
  signedUrl: string
  buffer: Buffer
  mimeType: string
  filename: string
}

type ExtractionSummary = Pick<DocumentExtractionOutput, 'extracted_value' | 'confidence' | 'reasoning'>

class RouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid kickback agreement id' }, { status: 400 })
    }
    const agreementId = parsedParams.data.id

    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)
    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient() as any
    const agreement = await loadKickbackAgreement(admin, agreementId)
    if (!agreement) {
      return NextResponse.json({ error: 'Kickback agreement not found' }, { status: 404 })
    }

    await assertVenueOwner(admin, agreement, auth.user.id)

    const existingPayment = await loadExistingPayment(admin, agreement.id)
    if (existingPayment && !['pending_venue_approval', 'invoice_failed'].includes(existingPayment.status)) {
      return NextResponse.json(
        { error: 'This kickback payment can no longer be changed from a spend report.' },
        { status: 409 }
      )
    }

    const formData = await request.formData()
    const override = revenueOverrideSchema.safeParse(formData.get('reported_revenue_cents_override'))
    if (!override.success) {
      return NextResponse.json({ error: 'reported_revenue_cents_override must be integer cents' }, { status: 400 })
    }

    const maybeFile = formData.get('image')
    if (!isUploadFile(maybeFile) && override.data === null) {
      return NextResponse.json(
        { error: 'Upload a spend report or enter verified revenue in cents.' },
        { status: 400 }
      )
    }

    const uploadedProof = isUploadFile(maybeFile)
      ? await uploadProofFile(admin, agreement.id, maybeFile)
      : null

    const extraction = uploadedProof
      ? await extractVenueRevenue(uploadedProof)
      : manualExtractionSummary()
    const reportedRevenueCents = override.data ?? extraction.extracted_value
    const now = new Date().toISOString()

    const updatePayload: Record<string, unknown> = {
      reported_revenue_cents: reportedRevenueCents,
      revenue_extracted_value_cents: extraction.extracted_value,
      revenue_extraction_confidence: extraction.confidence,
      revenue_submitted_at: now,
      updated_at: now,
    }

    if (uploadedProof) {
      updatePayload.revenue_proof_url = uploadedProof.path
    }

    const { error: agreementUpdateError } = await admin
      .from('event_kickback_agreements')
      .update(updatePayload)
      .eq('id', agreement.id)

    if (agreementUpdateError) {
      throw new Error(agreementUpdateError.message ?? 'Failed to update kickback agreement')
    }

    const calculatedOwedCents = await calculateKickbackOwedCents(admin, agreement, reportedRevenueCents)
    const payment = await upsertKickbackPayment(admin, agreement, calculatedOwedCents, existingPayment?.id ?? null, now)

    return NextResponse.json({
      extracted_value: extraction.extracted_value,
      confidence: extraction.confidence,
      reasoning: extraction.reasoning,
      calculated_owed_cents: calculatedOwedCents,
      payment_id: payment.id,
    })
  } catch (error) {
    console.error('[venue.kickbacks.spend-report] Failed to submit spend report', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to submit spend report' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

async function loadKickbackAgreement(admin: any, agreementId: string): Promise<KickbackAgreementRow | null> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select(
      [
        'id',
        'event_id',
        'plan_id',
        'venue_id',
        'venue_owner_id',
        'builder_id',
        'actual_attendance',
        'per_head_amount',
        'lift_share_percentage',
        'baseline_sales',
        'actual_sales',
        'bar_revenue_share_percent',
        'ticket_revenue_share_percent',
      ].join(', ')
    )
    .eq('id', agreementId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to load kickback agreement')
  }

  return (data as KickbackAgreementRow | null) ?? null
}

async function assertVenueOwner(admin: any, agreement: KickbackAgreementRow, userId: string) {
  if (agreement.venue_owner_id === userId) return

  const { data, error } = await admin
    .from('venues')
    .select('owner_id')
    .eq('id', agreement.venue_id)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to verify venue owner')
  if ((data as { owner_id?: string | null } | null)?.owner_id !== userId) {
    throw new RouteError('Not authorized for this venue kickback', 403)
  }
}

async function loadExistingPayment(admin: any, agreementId: string): Promise<ExistingPaymentRow | null> {
  const { data, error } = await admin
    .from('kickback_payments')
    .select('id, status')
    .eq('agreement_id', agreementId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to load kickback payment')
  }

  return (data as ExistingPaymentRow | null) ?? null
}

async function upsertKickbackPayment(
  admin: any,
  agreement: KickbackAgreementRow,
  amountCents: number,
  existingPaymentId: string | null,
  now: string
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    agreement_id: agreement.id,
    event_id: agreement.event_id,
    payer_id: agreement.venue_owner_id,
    recipient_id: agreement.builder_id,
    amount_cents: amountCents,
    currency: 'usd',
    status: 'pending_venue_approval',
    settlement_method: 'invoice',
    updated_at: now,
  }

  if (existingPaymentId) {
    payload.id = existingPaymentId
  }

  const { data, error } = await admin
    .from('kickback_payments')
    .upsert(payload, { onConflict: 'agreement_id' })
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to create kickback payment')
  }

  if (!data?.id) {
    throw new Error('Kickback payment was not returned after upsert')
  }

  return data as { id: string }
}

async function calculateKickbackOwedCents(
  admin: any,
  agreement: KickbackAgreementRow,
  reportedRevenueCents: number | null
) {
  const reportedCents = reportedRevenueCents ?? 0
  const barSharePercent = readPositiveNumber(agreement.bar_revenue_share_percent)
  if (barSharePercent > 0) {
    return Math.round(reportedCents * (barSharePercent / 100))
  }

  const ticketSharePercent = readPositiveNumber(agreement.ticket_revenue_share_percent)
  if (ticketSharePercent > 0) {
    const ticketRevenueCents = await loadTicketRevenueCents(admin, agreement.event_id)
    return Math.round(ticketRevenueCents * (ticketSharePercent / 100))
  }

  const liftSharePercent = readPositiveNumber(agreement.lift_share_percentage)
  if (liftSharePercent > 0) {
    const baselineSalesCents = dollarsToCents(agreement.baseline_sales)
    const actualSalesCents = reportedRevenueCents ?? dollarsToCents(agreement.actual_sales)
    return Math.round(Math.max(actualSalesCents - baselineSalesCents, 0) * (liftSharePercent / 100))
  }

  const perHeadCents = dollarsToCents(agreement.per_head_amount)
  const attendance = Number(agreement.actual_attendance ?? 0)
  if (perHeadCents > 0 && attendance > 0) {
    return perHeadCents * attendance
  }

  return 0
}

async function loadTicketRevenueCents(admin: any, eventId: string | null) {
  if (!eventId) return 0

  const { data, error } = await admin
    .from('event_sales_data')
    .select('total_amount_cents, total_amount, total_sales')
    .eq('event_id', eventId)

  if (error) {
    throw new Error(error.message ?? 'Failed to load ticket revenue')
  }

  return ((data ?? []) as Array<Record<string, number | string | null | undefined>>).reduce((sum, row) => {
    const cents = readCents(row.total_amount_cents, row.total_amount ?? row.total_sales)
    return sum + (cents ?? 0)
  }, 0)
}

async function uploadProofFile(admin: any, agreementId: string, file: File): Promise<UploadedProof> {
  if (!isAllowedMimeType(file.type)) {
    throw new RouteError('Unsupported file type. Upload a screenshot, PDF, CSV, or Excel file.', 400)
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new RouteError('File is too large. Upload a file under 10 MB.', 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = sanitizeFilename(file.name || 'venue-spend-report')
  const path = `${agreementId}/${Date.now()}-${filename}`

  const { error: uploadError } = await admin.storage
    .from(SPEND_REPORT_BUCKET)
    .upload(path, buffer, {
      contentType: file.type || undefined,
      upsert: false,
    })

  if (uploadError) {
    throw new Error(uploadError.message ?? 'Failed to upload spend report')
  }

  const { data: signed, error: signedUrlError } = await admin.storage
    .from(SPEND_REPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (signedUrlError || !signed?.signedUrl) {
    throw new Error(signedUrlError?.message ?? 'Failed to create spend report signed URL')
  }

  return {
    path,
    signedUrl: signed.signedUrl,
    buffer,
    mimeType: file.type,
    filename,
  }
}

async function extractVenueRevenue(proof: UploadedProof): Promise<ExtractionSummary> {
  const isImage = proof.mimeType.startsWith('image/')
  const result = await runDocumentExtractionAgent({
    mode: 'venue_revenue',
    imageUrl: isImage ? proof.signedUrl : undefined,
    fileBuffer: isImage ? undefined : proof.buffer,
    mimeType: proof.mimeType,
    filename: proof.filename,
  })

  return {
    extracted_value: result.output.extracted_value,
    confidence: result.output.confidence,
    reasoning: result.output.reasoning,
  }
}

function manualExtractionSummary(): ExtractionSummary {
  return {
    extracted_value: null,
    confidence: 'high',
    reasoning: 'Manual venue revenue override submitted without document extraction.',
  }
}

function readPositiveNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value
  return typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== 'undefined' && value instanceof File && value.size > 0
}

function isAllowedMimeType(mimeType: string) {
  return (DOCUMENT_EXTRACTION_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)
}

function sanitizeFilename(filename: string) {
  const sanitized = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  return sanitized || 'venue-spend-report'
}
