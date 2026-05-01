export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { parse } from 'csv-parse/sync'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type CsvCheckInRow = Record<string, string | undefined>

/**
 * Reads a value from a CSV row using several possible header names.
 *
 * @param row - Parsed CSV row keyed by column header.
 * @param keys - Accepted column names in priority order.
 * @returns The first non-empty column value.
 */
function readCsvValue(row: CsvCheckInRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Converts common CSV boolean strings into a boolean.
 *
 * @param value - CSV cell value such as true, yes, 1, checked in.
 * @returns True when the value indicates the attendee checked in.
 */
function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  return ['true', 'yes', 'y', '1', 'checked in', 'checked-in', 'attended'].includes(normalized)
}

/**
 * Splits a full name into first and last names for fallback attendee matching.
 *
 * @param name - CSV full name cell.
 * @returns First/last name pair.
 */
function splitName(name: string) {
  const parts = name.trim().split(/\s+/)
  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

/**
 * Verifies that the current authenticated user owns the event as its builder.
 *
 * @param eventId - Internal 3rdSpace event id.
 * @returns Authenticated user and builder profile id, or an HTTP response on failure.
 */
async function verifyBuilderEventAccess(eventId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { supabase, user: null, builderProfileId: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)

  if (builderError || !builderProfileId) {
    return { supabase, user, builderProfileId: null, response: NextResponse.json({ error: 'Builder profile not found' }, { status: 403 }) }
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (eventError) {
    console.error('[Check-in Upload] Event ownership lookup failed', eventError)
    return { supabase, user, builderProfileId, response: NextResponse.json({ error: 'Failed to verify event access' }, { status: 500 }) }
  }

  if (!event) {
    return { supabase, user, builderProfileId, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) }
  }

  return { supabase, user, builderProfileId, response: null }
}

/**
 * Parses an uploaded CSV file into records with normalized header access.
 *
 * @param file - Uploaded check-in CSV file.
 * @returns Parsed records.
 */
async function parseCheckInCsv(file: File) {
  const fileContent = await file.text()

  return parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvCheckInRow[]
}

/**
 * Updates imported attendee check-in state using CSV records.
 *
 * Matching is primarily by email because Posh/Luma exports vary, but fallback
 * name matching is attempted when no email is present.
 *
 * @param eventId - Internal 3rdSpace event id.
 * @param records - Parsed CSV records.
 * @returns Count of CSV rows matched to attendee updates.
 */
async function updateAttendeeCheckIns(eventId: string, records: CsvCheckInRow[]) {
  const admin = createServiceRoleClient()
  let matchedRows = 0

  for (const row of records) {
    const email = readCsvValue(row, ['Email', 'email', 'Ticket Buyer Email', 'Buyer Email'])
    const name = readCsvValue(row, ['Name', 'name', 'Full Name', 'Guest Name', 'Ticket Buyer Name'])
    const checkInTime = readCsvValue(row, ['Check-in Time', 'check_in_time', 'Checked In At', 'checked_in_at'])
    const checkedIn = parseBoolean(readCsvValue(row, ['Checked In', 'checked_in', 'Checked In?', 'Status']))

    if (!email && !name) continue

    const updatePayload = {
      checked_in: checkedIn,
      check_in_time: checkedIn && checkInTime ? checkInTime : null,
      check_in_method: 'csv_upload',
      updated_at: new Date().toISOString(),
    }

    let query = admin
      .from('imported_attendees')
      .update(updatePayload as never)
      .eq('event_id', eventId)

    if (email) {
      query = query.eq('email', email)
    } else {
      const { firstName, lastName } = splitName(name)
      query = query.eq('first_name', firstName || '')
      if (lastName) query = query.eq('last_name', lastName)
    }

    const { data, error } = await query.select('id')

    if (error) {
      console.error('[Check-in Upload] Failed to update attendee row', { email, name, error })
      continue
    }

    if (((data as Array<{ id: string }> | null) ?? []).length > 0) matchedRows += 1
  }

  return matchedRows
}

/**
 * Loads the post-upload attendance summary used for kickback reporting.
 *
 * @param eventId - Internal 3rdSpace event id.
 * @returns Ticket count, checked-in count, no-shows, and show-up rate.
 */
async function loadAttendanceSummary(eventId: string) {
  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('imported_attendees')
    .select('checked_in')
    .eq('event_id', eventId)

  if (error) throw error

  const totalTickets = data?.length ?? 0
  const checkedIn = data?.filter((attendee: { checked_in: boolean | null }) => attendee.checked_in).length ?? 0
  const noShows = Math.max(totalTickets - checkedIn, 0)
  const showUpRate = totalTickets > 0 ? (checkedIn / totalTickets) * 100 : 0

  return {
    totalTickets,
    checkedIn,
    noShows,
    showUpRate,
  }
}

/**
 * Uploads post-event check-in CSV data and recalculates kickback eligibility.
 *
 * CSV uploads are required for actual kickbacks because ticket sales are only
 * projected attendance. The kickback RPC uses verified imported_attendees rows
 * where `checked_in = true`.
 *
 * @param request - Multipart request with a `file` CSV field.
 * @param params - Route params containing the event id.
 * @returns Upload, attendance, and kickback summary.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const { response } = await verifyBuilderEventAccess(params.eventId)
    if (response) return response

    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No CSV file uploaded' }, { status: 400 })
    }

    let records: CsvCheckInRow[]
    try {
      records = await parseCheckInCsv(file)
    } catch (error) {
      console.error('[Check-in Upload] CSV parsing failed', error)
      return NextResponse.json({ error: 'Could not parse CSV file' }, { status: 400 })
    }

    console.log('[Check-in Upload] Processing records', {
      eventId: params.eventId,
      records: records.length,
    })

    const matchedRows = await updateAttendeeCheckIns(params.eventId, records)
    const attendance = await loadAttendanceSummary(params.eventId)
    const admin = createServiceRoleClient()
    const { data: kickbackCalc, error: kickbackError } = await admin.rpc('calculate_event_kickback', {
      p_event_id: params.eventId,
    } as never)

    if (kickbackError) {
      console.error('[Check-in Upload] Kickback calculation failed', kickbackError)
      throw kickbackError
    }

    console.log('[Check-in Upload] Completed', {
      eventId: params.eventId,
      matchedRows,
      attendance,
      kickbackCalc,
    })

    return NextResponse.json({
      success: true,
      total_tickets: attendance.totalTickets,
      checked_in: attendance.checkedIn,
      no_shows: attendance.noShows,
      show_up_rate: Number(attendance.showUpRate.toFixed(1)),
      kickback_amount:
        typeof kickbackCalc === 'object' && kickbackCalc && 'kickback_amount' in kickbackCalc
          ? (kickbackCalc as { kickback_amount?: number }).kickback_amount ?? 0
          : 0,
      matched_rows: matchedRows,
      message: `Processed ${records.length} check-in records`,
    })
  } catch (error) {
    console.error('[Check-in Upload] Error', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload check-ins' },
      { status: 500 }
    )
  }
}
