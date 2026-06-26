export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import {
  RECEIPT_EXTRACTION_ALLOWED_MIME_TYPES,
  runReceiptExtractionAgent,
  type ReceiptExtractionOutput,
} from '@/lib/ai/agents/receiptExtractionAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const EVENT_EVIDENCE_BUCKET = 'event-evidence'
const SIGNED_URL_TTL_SECONDS = 60 * 60
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const paramsSchema = z.object({
  eventId: z.string().uuid(),
})

type PlannerDb = { from: (table: string) => any; storage?: any }

type CommitmentRow = {
  id: string
  party_name: string | null
  amount_cents: number
  state: string
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 })
    }

    const access = await getEventAccess(parsedParams.data.eventId)
    if ('response' in access) return access.response

    const formData = await request.formData()
    const maybeFile = formData.get('file')
    if (!isUploadFile(maybeFile)) {
      return NextResponse.json({ error: 'Upload a receipt image or PDF.' }, { status: 400 })
    }

    if (!isAllowedMimeType(maybeFile.type)) {
      return NextResponse.json({ error: 'Unsupported file type. Upload a PNG, JPEG, HEIC, or PDF receipt.' }, { status: 400 })
    }

    if (maybeFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Receipt is too large. Upload a file under 10 MB.' }, { status: 400 })
    }

    const commitmentId = readFormString(formData.get('commitment_id')) ?? 'pending'
    const buffer = Buffer.from(await maybeFile.arrayBuffer())
    const filename = sanitizeFilename(maybeFile.name || 'receipt')
    const path = `${access.builderProfileId}/${access.eventId}/${commitmentId}/${randomUUID()}-${filename}`

    const { error: uploadError } = await access.admin.storage
      .from(EVENT_EVIDENCE_BUCKET)
      .upload(path, buffer, {
        contentType: maybeFile.type || undefined,
        upsert: false,
      })

    if (uploadError) throw new Error(uploadError.message ?? 'Failed to upload receipt')

    const { data: signed, error: signedUrlError } = await access.admin.storage
      .from(EVENT_EVIDENCE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (signedUrlError || !signed?.signedUrl) {
      throw new Error(signedUrlError?.message ?? 'Failed to create receipt signed URL')
    }

    const extractionResult = await runReceiptExtractionAgent({
      fileBuffer: buffer,
      mimeType: maybeFile.type,
      filename,
    })
    const extraction = extractionResult.output
    const commitments = await loadCommitments(access.admin, access.eventId)
    const suggestions = suggestCommitmentMatches(commitments, extraction)

    return NextResponse.json({
      receipt: {
        path,
        signed_url: signed.signedUrl,
        filename,
      },
      extraction,
      suggested_commitments: suggestions,
    })
  } catch (error) {
    console.error('[planner.event.receipts] Failed to upload receipt', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload receipt' },
      { status: 500 }
    )
  }
}

async function getEventAccess(eventId: string): Promise<
  | { admin: PlannerDb; builderProfileId: string; eventId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  const db = supabase as unknown as PlannerDb
  const { data: event, error: eventError } = await db
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) throw new Error(eventError.message ?? 'Failed to verify event access')
  if (!event) return { response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }

  return {
    admin: createServiceRoleClient() as unknown as PlannerDb,
    builderProfileId,
    eventId,
  }
}

async function loadCommitments(admin: PlannerDb, eventId: string): Promise<CommitmentRow[]> {
  const { data, error } = await admin
    .from('event_cost_commitments')
    .select('id, party_name, amount_cents, state')
    .eq('event_id', eventId)

  if (error) throw new Error(error.message ?? 'Failed to load commitment matches')
  return (data ?? []) as CommitmentRow[]
}

function suggestCommitmentMatches(commitments: CommitmentRow[], extraction: ReceiptExtractionOutput) {
  return commitments
    .map((commitment) => ({
      id: commitment.id,
      party_name: commitment.party_name,
      amount_cents: commitment.amount_cents,
      state: commitment.state,
      score: matchScore(commitment, extraction),
    }))
    .filter((match) => match.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 5)
}

function matchScore(commitment: CommitmentRow, extraction: ReceiptExtractionOutput) {
  let score = 0
  if (extraction.amount_cents !== null && withinTenPercent(commitment.amount_cents, extraction.amount_cents)) {
    score += 0.65
  }

  const commitmentName = normalizeText(commitment.party_name)
  const extractedName = normalizeText(extraction.vendor_or_payee)
  if (commitmentName && extractedName) {
    if (commitmentName === extractedName) score += 0.35
    else if (commitmentName.includes(extractedName) || extractedName.includes(commitmentName)) score += 0.25
  }

  if (commitment.state === 'paid' || commitment.state === 'cancelled') score -= 0.4
  return Math.max(0, Number(score.toFixed(2)))
}

function withinTenPercent(expected: number, actual: number) {
  if (expected === 0) return actual === 0
  return Math.abs(expected - actual) / expected <= 0.1
}

function normalizeText(value: string | null) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== 'undefined' && value instanceof File && value.size > 0
}

function isAllowedMimeType(mimeType: string) {
  return (RECEIPT_EXTRACTION_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)
}

function readFormString(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sanitizeFilename(filename: string) {
  const sanitized = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  return sanitized || 'receipt'
}
