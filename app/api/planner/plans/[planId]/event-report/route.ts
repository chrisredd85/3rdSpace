export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  DOCUMENT_EXTRACTION_ALLOWED_MIME_TYPES,
  runDocumentExtractionAgent,
  type DocumentExtractionOutput,
} from '@/lib/ai/agents/documentExtractionAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const EVENT_REPORT_BUCKET = 'event-reports'
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const paramsSchema = z.object({
  planId: z.string().uuid(),
})

const attendanceOverrideSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'string') return Number(value)
    return value
  },
  z.number().int().nonnegative().nullable()
)

type PlannerDb = { from: (table: string) => any }

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }

type PlanRow = {
  id: string
  user_id: string
  title: string | null
  date_window_start: string | null
}

type KickbackAgreementRow = {
  id: string
  venue_id: string | null
  actual_attendance: number | null
  attendance_submitted_at: string | null
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

export async function GET(
  _request: NextRequest,
  context: { params: { planId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
    }

    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, parsedParams.data.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const admin = createServiceRoleClient() as any
    const agreements = await loadPlanKickbackAgreements(admin, plan.id)
    const venueNames = await loadAgreementVenueNames(admin, agreements)
    const pendingAgreements = agreements.filter((agreement) => agreement.actual_attendance == null)
    const eventHasPassed = hasDatePassed(plan.date_window_start)

    return NextResponse.json({
      eligible: eventHasPassed && pendingAgreements.length > 0,
      event_has_passed: eventHasPassed,
      event_name: plan.title ?? 'Untitled event',
      event_date: plan.date_window_start,
      agreement_count: agreements.length,
      submitted_agreements: agreements.length - pendingAgreements.length,
      pending_agreements: pendingAgreements.map((agreement) => ({
        id: agreement.id,
        venue_id: agreement.venue_id,
        venue_name: agreement.venue_id ? venueNames.get(agreement.venue_id) ?? 'Venue' : 'Venue',
      })),
    })
  } catch (error) {
    console.error('[planner.event-report] Failed to load event report status', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load event report status' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { planId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
    }

    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, parsedParams.data.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const formData = await request.formData()
    const override = attendanceOverrideSchema.safeParse(formData.get('actual_attendance_override'))
    if (!override.success) {
      return NextResponse.json({ error: 'actual_attendance_override must be a non-negative integer' }, { status: 400 })
    }

    const maybeFile = formData.get('image')
    if (!isUploadFile(maybeFile) && override.data === null) {
      return NextResponse.json(
        { error: 'Upload a screenshot/report or enter a verified attendance count.' },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient() as any
    const agreements = await loadPlanKickbackAgreements(admin, plan.id)
    if (agreements.length === 0) {
      return NextResponse.json({ error: 'No kickback agreement found for this plan' }, { status: 404 })
    }

    const uploadedProof = isUploadFile(maybeFile)
      ? await uploadProofFile(admin, plan.id, maybeFile)
      : null

    const extraction = uploadedProof
      ? await extractAttendance(uploadedProof)
      : manualExtractionSummary()
    const finalAttendance = override.data ?? extraction.extracted_value
    const now = new Date().toISOString()

    const updatePayload: Record<string, unknown> = {
      actual_attendance: finalAttendance,
      attendance_extracted_value: extraction.extracted_value,
      attendance_extraction_confidence: extraction.confidence,
      attendance_submitted_at: now,
      updated_at: now,
    }

    if (uploadedProof) {
      updatePayload.attendance_proof_url = uploadedProof.path
    }

    const { error: updateError } = await admin
      .from('event_kickback_agreements')
      .update(updatePayload)
      .in('id', agreements.map((agreement) => agreement.id))

    if (updateError) {
      throw new Error(updateError.message ?? 'Failed to update kickback agreement')
    }

    return NextResponse.json({
      extracted_value: extraction.extracted_value,
      confidence: extraction.confidence,
      reasoning: extraction.reasoning,
      agreement_id: agreements[0]?.id ?? null,
      final_attendance: finalAttendance,
    })
  } catch (error) {
    console.error('[planner.event-report] Failed to submit event report', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit event report' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

async function getAuthenticatedPlannerDb(): Promise<PlannerAuth> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<PlanRow | null> {
  const { data, error } = await db
    .from('plans')
    .select('id, user_id, title, date_window_start')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Failed to load plan')
  }

  return (data as PlanRow | null) ?? null
}

async function loadPlanKickbackAgreements(admin: any, planId: string): Promise<KickbackAgreementRow[]> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select('id, venue_id, actual_attendance, attendance_submitted_at')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Failed to load kickback agreement')
  }

  return (data ?? []) as KickbackAgreementRow[]
}

async function loadAgreementVenueNames(admin: any, agreements: KickbackAgreementRow[]) {
  const venueIds = Array.from(new Set(
    agreements
      .map((agreement) => agreement.venue_id)
      .filter((venueId): venueId is string => Boolean(venueId))
  ))
  if (venueIds.length === 0) return new Map<string, string>()

  const { data, error } = await admin
    .from('venues')
    .select('id, venue_name, name')
    .in('id', venueIds)

  if (error) {
    throw new Error(error.message ?? 'Failed to load agreement venues')
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; venue_name?: string | null; name?: string | null }>)
      .map((venue) => [venue.id, venue.venue_name ?? venue.name ?? 'Venue'])
  )
}

function hasDatePassed(value: string | null) {
  if (!value) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now()
}

async function uploadProofFile(admin: any, planId: string, file: File): Promise<UploadedProof> {
  if (!isAllowedMimeType(file.type)) {
    throw new RouteError('Unsupported file type. Upload a screenshot, PDF, CSV, or Excel file.', 400)
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new RouteError('File is too large. Upload a file under 10 MB.', 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = sanitizeFilename(file.name || 'event-report')
  const path = `${planId}/${Date.now()}-${filename}`

  const { error: uploadError } = await admin.storage
    .from(EVENT_REPORT_BUCKET)
    .upload(path, buffer, {
      contentType: file.type || undefined,
      upsert: false,
    })

  if (uploadError) {
    throw new Error(uploadError.message ?? 'Failed to upload event report')
  }

  const { data: signed, error: signedUrlError } = await admin.storage
    .from(EVENT_REPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (signedUrlError || !signed?.signedUrl) {
    throw new Error(signedUrlError?.message ?? 'Failed to create event report signed URL')
  }

  return {
    path,
    signedUrl: signed.signedUrl,
    buffer,
    mimeType: file.type,
    filename,
  }
}

async function extractAttendance(proof: UploadedProof): Promise<ExtractionSummary> {
  const isImage = proof.mimeType.startsWith('image/')
  const result = await runDocumentExtractionAgent({
    mode: 'headcount',
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
    reasoning: 'Manual attendance override submitted without document extraction.',
  }
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

  return sanitized || 'event-report'
}
