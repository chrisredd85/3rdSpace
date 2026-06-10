export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { parse } from 'csv-parse/sync'
import {
  isCHINewEngineEnabled,
  isCHIVenueTypeEligible,
} from '@/lib/finance/community-host-incentive'
import {
  upsertCommunityHostIncentiveFromLegacy,
  upsertLegacyPaymentCompatibilityForCHI,
  type LegacyVenueSettlementAgreement,
} from '@/lib/finance/legacySettlementAdapter'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type CsvCheckInRow = Record<string, string | undefined>

type LegacyAgreementForAttendance = LegacyVenueSettlementAgreement & {
  venues?: { venue_type?: string | null } | { venue_type?: string | null }[] | null
}

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
 * @param eventId - Internal 3rdPlace event id.
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
 * @param eventId - Internal 3rdPlace event id.
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
 * Loads the post-upload attendance summary used for CHI reporting.
 *
 * @param eventId - Internal 3rdPlace event id.
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
 * Uploads post-event check-in CSV data and recalculates CHI eligibility.
 *
 * CSV uploads are required because ticket sales are only projected attendance.
 * CHI uses verified imported_attendees rows where `checked_in = true`.
 *
 * @param request - Multipart request with a `file` CSV field.
 * @param params - Route params containing the event id.
 * @returns Upload, attendance, and CHI summary.
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
    const admin = createServiceRoleClient()
    const attendance = await loadAttendanceSummary(params.eventId)
    const settlement = isCHINewEngineEnabled()
      ? await updateCommunityHostIncentivesForAttendance(admin, params.eventId, attendance.checkedIn)
      : await updateLegacySettlementForAttendance(admin, params.eventId)

    console.log('[Check-in Upload] Completed', {
      eventId: params.eventId,
      matchedRows,
      attendance,
      settlement,
    })

    return NextResponse.json({
      success: true,
      total_tickets: attendance.totalTickets,
      checked_in: attendance.checkedIn,
      no_shows: attendance.noShows,
      show_up_rate: Number(attendance.showUpRate.toFixed(1)),
      community_host_incentive_amount_cents: settlement.amountCents,
      kickback_amount: settlement.legacyAmountForCompatibility,
      chi_settlement_ids: settlement.chiSettlementIds,
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

async function updateLegacySettlementForAttendance(admin: any, eventId: string) {
  const { data, error } = await admin.rpc('calculate_event_kickback', {
    p_event_id: eventId,
  } as never)

  if (error) {
    console.error('[Check-in Upload] Legacy settlement calculation failed', error)
    throw error
  }

  const amountDollars =
    typeof data === 'object' && data && 'kickback_amount' in data
      ? Number((data as { kickback_amount?: number }).kickback_amount ?? 0)
      : 0

  return {
    amountCents: Math.round(amountDollars * 100),
    legacyAmountForCompatibility: amountDollars,
    chiSettlementIds: [],
  }
}

async function updateCommunityHostIncentivesForAttendance(
  admin: any,
  eventId: string,
  checkedIn: number
) {
  const agreements = await loadEventAgreementsForCHI(admin, eventId)
  const eligibleAgreements = agreements.filter((agreement) => {
    const venue = Array.isArray(agreement.venues) ? agreement.venues[0] : agreement.venues
    return isCHIVenueTypeEligible(venue?.venue_type)
  })
  const now = new Date().toISOString()
  let amountCents = 0
  const chiSettlementIds: string[] = []

  for (const agreement of eligibleAgreements) {
    await updateAgreementAttendance(admin, agreement.id, checkedIn, now)
    const sourceAgreement = {
      ...agreement,
      actual_attendance: checkedIn,
      actual_qualified_attendance: checkedIn,
    }
    const chi = await upsertCommunityHostIncentiveFromLegacy(admin, {
      sourceAgreement,
      organizerUserId: agreement.builder_id,
      venueOwnerUserId: agreement.venue_owner_id,
      approvedAt: agreement.venue_approved_at ?? now,
      approvedByVenueUserId: agreement.venue_owner_id,
      principalCents: 0,
      now,
    })
    amountCents += chi.chiResult.organizerPayoutCents
    chiSettlementIds.push(chi.chiSettlement.id)

    if (chi.chiResult.organizerPayoutCents > 0) {
      await upsertLegacyPaymentCompatibilityForCHI(admin, {
        sourceAgreement,
        amountCents: chi.chiResult.organizerPayoutCents,
        status: 'pending_venue_approval',
        now,
      })
    }
  }

  return {
    amountCents,
    legacyAmountForCompatibility: amountCents / 100,
    chiSettlementIds,
  }
}

async function loadEventAgreementsForCHI(
  admin: any,
  eventId: string
): Promise<LegacyAgreementForAttendance[]> {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select(
      [
        'id',
        'event_id',
        'plan_id',
        'venue_id',
        'builder_id',
        'venue_owner_id',
        'actual_attendance',
        'actual_qualified_attendance',
        'attendance_extracted_value',
        'attendance_proof_url',
        'per_head_amount',
        'minimum_attendees',
        'maximum_payout',
        'venue_approved',
        'venue_approved_at',
        'disputed_at',
        'venues(venue_type)',
      ].join(', ')
    )
    .eq('event_id', eventId)

  if (error) throw new Error(error.message ?? 'Failed to load CHI agreements')
  return (data ?? []) as LegacyAgreementForAttendance[]
}

async function updateAgreementAttendance(
  admin: any,
  agreementId: string,
  checkedIn: number,
  now: string
) {
  const { error } = await admin
    .from('event_kickback_agreements')
    .update({
      actual_attendance: checkedIn,
      actual_qualified_attendance: checkedIn,
      attendance_submitted_at: now,
      updated_at: now,
    })
    .eq('id', agreementId)

  if (error) throw new Error(error.message ?? 'Failed to update CHI attendance')
}
