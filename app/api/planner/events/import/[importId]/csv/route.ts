export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  detectCsvMapping,
  normalizeAttendeeRows,
  normalizeSalesRows,
  parseCsvImport,
  type CsvImportKind,
  type CsvMapping,
  type CsvRow,
} from '@/lib/integrations/csv/parse'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type SupabaseAdminClient = any

const jsonMappingSchema = z.object({
  kind: z.enum(['attendees', 'sales']),
  mapping: z.record(z.string()).optional(),
  use_existing: z.boolean().optional(),
})

type BuilderAuth =
  | { userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

type ImportSession = {
  id: string
  builder_id: string
  event_id: string | null
  source: 'posh' | 'eventbrite' | 'luma' | 'partiful' | 'other'
  payload: Record<string, any>
}

export async function POST(request: NextRequest, props: { params: Promise<{ importId: string }> }) {
  const params = await props.params;
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const admin = createServiceRoleClient() as SupabaseAdminClient
    const session = await loadSession(admin, params.importId, auth.builderProfileId)
    if (!session) return NextResponse.json({ error: 'Import session not found' }, { status: 404 })

    const contentType = request.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json')
      ? await readJsonMappingRequest(request, session)
      : await readMultipartCsvRequest(request)

    const parsed = body.text
      ? parseCsvImport(body.text, body.kind, body.mapping)
      : parseStoredRows(session, body.kind, body.mapping)

    const payload: Record<string, any> = {
      ...(session.payload ?? {}),
      csv_uploads: {
        ...((session.payload?.csv_uploads as Record<string, unknown> | undefined) ?? {}),
        [body.kind]: {
          headers: parsed.headers,
          rows: parsed.rows.slice(0, 10000),
          previewRows: parsed.previewRows,
          mapping: parsed.mapping.mapping,
          needsMapping: parsed.mapping.needsMapping,
        },
      },
    }

    if (!parsed.mapping.needsMapping) {
      if (body.kind === 'attendees') {
        payload.attendees = normalizeAttendeeRows({
          rows: parsed.rows,
          mapping: parsed.mapping.mapping,
          source: session.source,
        })
      } else {
        payload.sales = normalizeSalesRows({
          rows: parsed.rows,
          mapping: parsed.mapping.mapping,
          source: session.source,
        })
      }
    }

    await updateSession(admin, session.id, payload, parsed.mapping.needsMapping ? 'mapping_required' : 'ready')

    return NextResponse.json({
      importId: session.id,
      kind: body.kind,
      headers: parsed.headers,
      previewRows: parsed.previewRows,
      mapping: parsed.mapping,
      counts: {
        rows: parsed.rows.length,
        attendees: Array.isArray(payload.attendees) ? payload.attendees.length : 0,
        sales: Array.isArray(payload.sales) ? payload.sales.length : 0,
      },
    })
  } catch (error) {
    console.error('[planner.events.import.csv] CSV import failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CSV import failed' },
      { status: 500 }
    )
  }
}

async function readMultipartCsvRequest(request: NextRequest) {
  const formData = await request.formData()
  const kind = normalizeKind(formData.get('kind'))
  const mappingRaw = formData.get('mapping')
  const mapping = typeof mappingRaw === 'string' && mappingRaw.trim()
    ? JSON.parse(mappingRaw) as CsvMapping
    : undefined
  const file = formData.get('file')
  if (!(file instanceof File)) throw new Error('Upload a CSV file')
  const text = await file.text()
  return { kind, mapping, text }
}

async function readJsonMappingRequest(request: NextRequest, session: ImportSession) {
  const parsed = jsonMappingSchema.parse(await request.json().catch(() => ({})))
  if (!parsed.use_existing) throw new Error('JSON CSV mapping requests must set use_existing')
  const upload = session.payload?.csv_uploads?.[parsed.kind]
  if (!upload?.rows || !upload?.headers) throw new Error('No staged CSV rows found for this mapping')
  return {
    kind: parsed.kind,
    mapping: parsed.mapping as CsvMapping | undefined,
    text: null,
  }
}

function parseStoredRows(session: ImportSession, kind: CsvImportKind, mapping?: CsvMapping) {
  const upload = session.payload?.csv_uploads?.[kind]
  const rows = Array.isArray(upload?.rows) ? upload.rows as CsvRow[] : []
  const headers = Array.isArray(upload?.headers) ? upload.headers as string[] : []
  if (rows.length === 0 || headers.length === 0) throw new Error('No staged CSV rows found')
  const mappingResult = detectCsvMapping(headers, kind, mapping)
  return {
    headers,
    rows,
    previewRows: rows.slice(0, 5),
    mapping: mappingResult,
  }
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  return { userId: user.id, builderProfileId }
}

async function loadSession(db: SupabaseAdminClient, importId: string, builderId: string) {
  const { data, error } = await db
    .from('event_import_sessions')
    .select('id, builder_id, event_id, source, payload')
    .eq('id', importId)
    .eq('builder_id', builderId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load import session')
  return data as ImportSession | null
}

async function updateSession(
  db: SupabaseAdminClient,
  importId: string,
  payload: Record<string, unknown>,
  status: 'mapping_required' | 'ready'
) {
  const { error } = await db
    .from('event_import_sessions')
    .update({
      payload,
      status,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', importId)

  if (error) throw new Error(error.message ?? 'Failed to update import session')
}

function normalizeKind(value: FormDataEntryValue | null): CsvImportKind {
  return value === 'sales' ? 'sales' : 'attendees'
}
