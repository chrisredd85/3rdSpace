export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildFieldConfidence, type CsvImportSource } from '@/lib/integrations/csv/parse'
import { scrapeEventPage, type ScrapedEventPage } from '@/lib/integrations/scrape/eventPage'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type SupabaseAdminClient = any

const createImportSchema = z.object({
  source: z.enum(['posh', 'eventbrite', 'luma', 'partiful', 'other']),
  event_url: z.string().url().optional().or(z.literal('')),
  event: z.object({
    event_name: z.string().trim().optional(),
    event_date: z.string().trim().optional(),
    start_time: z.string().trim().optional(),
    end_time: z.string().trim().optional(),
    expected_attendance: z.number().int().nonnegative().optional().nullable(),
    description: z.string().trim().optional(),
    venue_name: z.string().trim().optional(),
  }).optional(),
})

type BuilderAuth =
  | { userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const body = createImportSchema.parse(await request.json().catch(() => ({})))
    const admin = createServiceRoleClient() as SupabaseAdminClient
    const scraped = body.event_url ? await tryScrapeEventPage(body.event_url) : null
    const shell = buildEventShell({
      source: body.source,
      manualEvent: body.event ?? {},
      scraped,
    })
    const now = new Date().toISOString()

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({
        builder_id: auth.builderProfileId,
        event_name: shell.event_name,
        event_type: 'other',
        event_description: shell.description,
        description: shell.description,
        expected_attendance: shell.expected_attendance,
        event_date: shell.event_date,
        start_time: shell.start_time,
        end_time: shell.end_time,
        duration_hours: shell.duration_hours,
        status: 'draft',
        is_recurring: false,
        budget: 0,
        field_confidence: shell.field_confidence,
        created_at: now,
        updated_at: now,
      } as never)
      .select('id')
      .single()

    if (eventError) throw new Error(eventError.message ?? 'Failed to create draft event')

    const eventId = (event as { id: string }).id
    const payload: Record<string, any> = {
      source: body.source,
      event: shell,
      scraped,
      attendees: [],
      sales: [],
      screenshot_extraction: null,
      missing_fields: [],
      csv_uploads: {},
    }

    const { data: session, error: sessionError } = await admin
      .from('event_import_sessions')
      .insert({
        builder_id: auth.builderProfileId,
        event_id: eventId,
        source: body.source,
        status: 'draft',
        event_url: body.event_url || null,
        payload,
        created_by: auth.userId,
        created_at: now,
        updated_at: now,
      } as never)
      .select('id')
      .single()

    if (sessionError) throw new Error(sessionError.message ?? 'Failed to create import session')

    return NextResponse.json({
      importId: (session as { id: string }).id,
      eventId,
      event: shell,
      scraped,
      source: body.source,
    })
  } catch (error) {
    console.error('[planner.events.import] Failed to create import session', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start event import' },
      { status: 500 }
    )
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

async function tryScrapeEventPage(url: string) {
  try {
    return await scrapeEventPage(url)
  } catch (error) {
    console.warn('[planner.events.import] Event page scrape failed', error)
    return null
  }
}

function buildEventShell(input: {
  source: CsvImportSource
  manualEvent: Record<string, unknown>
  scraped: ScrapedEventPage | null
}) {
  const fallbackDate = new Date().toISOString().slice(0, 10)
  const manualName = readString(input.manualEvent.event_name)
  const manualDate = readString(input.manualEvent.event_date)
  const manualStart = normalizeTime(readString(input.manualEvent.start_time))
  const manualEnd = normalizeTime(readString(input.manualEvent.end_time))
  const manualDescription = readString(input.manualEvent.description)
  const expectedAttendance = readNumber(input.manualEvent.expected_attendance)
  const startTime = manualStart ?? input.scraped?.start_time ?? '18:00:00'
  const endTime = manualEnd ?? input.scraped?.end_time ?? '21:00:00'

  return {
    event_name: manualName ?? input.scraped?.event_name ?? 'Imported event draft',
    event_date: manualDate ?? input.scraped?.event_date ?? fallbackDate,
    start_time: startTime,
    end_time: endTime,
    duration_hours: durationHours(startTime, endTime),
    expected_attendance: expectedAttendance,
    description: manualDescription ?? input.scraped?.description ?? null,
    venue_name: readString(input.manualEvent.venue_name) ?? input.scraped?.venue_name ?? null,
    cover_image_url: input.scraped?.cover_image_url ?? null,
    field_confidence: {
      ...(input.scraped?.field_confidence ?? {}),
      ...buildFieldConfidence(
        [
          ...(manualName ? ['event_name'] : []),
          ...(manualDate ? ['event_date'] : []),
          ...(manualStart ? ['start_time'] : []),
          ...(manualEnd ? ['end_time'] : []),
          ...(expectedAttendance !== null ? ['expected_attendance'] : []),
        ],
        'high',
        'manual'
      ),
      ...buildFieldConfidence(
        [
          ...(!manualName && !input.scraped?.event_name ? ['event_name'] : []),
          ...(!manualDate && !input.scraped?.event_date ? ['event_date'] : []),
          ...(!manualStart && !input.scraped?.start_time ? ['start_time'] : []),
          ...(!manualEnd && !input.scraped?.end_time ? ['end_time'] : []),
        ],
        'low',
        `${input.source}_fallback`
      ),
    },
  }
}

function durationHours(startTime: string, endTime: string) {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  const minutes = Math.max(end - start, 60)
  return Math.round((minutes / 60) * 10) / 10
}

function timeToMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')
  return (Number(hour) || 0) * 60 + (Number(minute) || 0)
}

function normalizeTime(value: string | null) {
  if (!value) return null
  const [hour = '18', minute = '00', second = '00'] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.slice(0, 2).padStart(2, '0')}`
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}
