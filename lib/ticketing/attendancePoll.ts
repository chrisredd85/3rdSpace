import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getBuilderConnectedTicketingPlatforms } from '@/lib/server/account-setup'
import { decryptSecret } from '@/lib/server/token-crypto'
import { pollEventbriteCheckedInCount } from '@/lib/ticketing/eventbritePoll'
import { pollLumaRsvpCount } from '@/lib/ticketing/lumaPoll'

export type AttendancePollResult = {
  source: 'eventbrite' | 'luma' | 'partiful' | 'posh' | 'none'
  attendance_count: number | null
  count_type: 'checked_in' | 'rsvp_only' | 'unavailable'
  confidence: 'high' | 'medium' | 'low'
  pulled_at: string
  raw_response?: unknown
  error?: string
}

type PlanRow = {
  id: string
  user_id: string
  title: string | null
  date_window_start: string | null
}

type BuilderProfileRow = {
  id: string
}

type IntegrationCandidate = {
  platform: 'eventbrite' | 'luma'
  external_event_id: string | null
  access_token_encrypted?: string | null
  api_key_encrypted?: string | null
  encrypted_credentials?: Record<string, unknown> | null
  config?: Record<string, unknown> | null
}

type BuilderTicketingConnectionRow = {
  platform: string
  access_token_encrypted: string | null
  config: Record<string, unknown> | null
}

const CACHE_TTL_MS = 5 * 60 * 1000
const pollCache = new Map<string, { expiresAt: number; result: AttendancePollResult }>()

export async function pollAttendanceForPlan(
  admin: SupabaseClient,
  planId: string
): Promise<AttendancePollResult> {
  const cached = pollCache.get(planId)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const result = await pollAttendanceForPlanUncached(admin, planId)
  pollCache.set(planId, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
  return result
}

export function clearAttendancePollCacheForTest() {
  pollCache.clear()
}

async function pollAttendanceForPlanUncached(admin: SupabaseClient, planId: string): Promise<AttendancePollResult> {
  try {
    const plan = await loadPlan(admin, planId)
    if (!plan) return unavailable('none', 'Plan not found')

    const builder = await loadBuilderProfile(admin, plan.user_id)
    if (!builder) return unavailable('none', 'Builder profile not found')

    const [candidate, connectedPlatforms, builderConnections] = await Promise.all([
      resolveTicketingCandidate(admin, plan, builder.id),
      getBuilderConnectedTicketingPlatforms(admin as never, plan.user_id),
      loadBuilderTicketingConnections(admin, builder.id),
    ])

    if (!candidate) {
      const connected = connectedPlatforms.find((platform) =>
        platform === 'eventbrite' || platform === 'luma' || platform === 'partiful' || platform === 'posh'
      )
      return unavailable(connected ?? 'none', connected ? 'No linked ticketing event found for this plan.' : 'No connected ticketing platform found.')
    }

    const externalEventId = readExternalEventId(candidate)
    if (!externalEventId) {
      return unavailable(candidate.platform, 'Ticketing connection is missing the linked event id.')
    }

    if (candidate.platform === 'eventbrite') {
      const accessToken = readEventbriteAccessToken(candidate, builderConnections)
      if (!accessToken) return unavailable('eventbrite', 'Eventbrite is connected but no access token is available.')

      const eventbriteResult = await pollEventbriteCheckedInCount({
        accessToken,
        eventbriteEventId: externalEventId,
      })
      return {
        source: 'eventbrite',
        attendance_count: eventbriteResult.checkedInCount,
        count_type: 'checked_in',
        confidence: 'high',
        pulled_at: new Date().toISOString(),
        raw_response: eventbriteResult.rawResponse,
      }
    }

    const lumaApiKey = readLumaApiKey(candidate)
    if (!lumaApiKey) return unavailable('luma', 'Luma API key is not configured.')

    const lumaResult = await pollLumaRsvpCount({
      apiKey: lumaApiKey,
      eventApiId: externalEventId,
    })
    return {
      source: 'luma',
      attendance_count: lumaResult.rsvpCount,
      count_type: 'rsvp_only',
      confidence: 'medium',
      pulled_at: new Date().toISOString(),
      raw_response: lumaResult.rawResponse,
    }
  } catch (error) {
    return unavailable('none', error instanceof Error ? error.message : 'Attendance poll failed')
  }
}

async function loadPlan(admin: SupabaseClient, planId: string): Promise<PlanRow | null> {
  const { data, error } = await (admin as any)
    .from('plans')
    .select('id, user_id, title, date_window_start')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load plan')
  return (data as PlanRow | null) ?? null
}

async function loadBuilderProfile(admin: SupabaseClient, userId: string): Promise<BuilderProfileRow | null> {
  const { data, error } = await (admin as any)
    .from('builder_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load builder profile')
  return (data as BuilderProfileRow | null) ?? null
}

async function resolveTicketingCandidate(
  admin: SupabaseClient,
  plan: PlanRow,
  builderId: string
): Promise<IntegrationCandidate | null> {
  const planConnection = await loadPlanProviderConnection(admin, plan.id)
  if (planConnection) return planConnection

  const explicitIntegration = await loadAgreementIntegration(admin, plan.id)
  if (explicitIntegration) return explicitIntegration

  return loadMatchedEventIntegration(admin, plan, builderId)
}

async function loadPlanProviderConnection(admin: SupabaseClient, planId: string): Promise<IntegrationCandidate | null> {
  try {
    const { data, error } = await (admin as any)
      .from('provider_connections')
      .select('provider, status, external_account_id, encrypted_credentials, config')
      .eq('plan_id', planId)
      .in('provider', ['eventbrite', 'luma'])
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) throw error
    const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
    if (!row || row.status === 'disabled') return null

    return {
      platform: row.provider as 'eventbrite' | 'luma',
      external_event_id: typeof row.external_account_id === 'string' ? row.external_account_id : null,
      encrypted_credentials: asRecord(row.encrypted_credentials),
      config: asRecord(row.config),
    }
  } catch (error) {
    if (!isMissingTableError(error)) throw error
    return null
  }
}

async function loadAgreementIntegration(admin: SupabaseClient, planId: string): Promise<IntegrationCandidate | null> {
  const { data: agreements, error: agreementsError } = await (admin as any)
    .from('event_kickback_agreements')
    .select('event_id')
    .eq('plan_id', planId)

  if (agreementsError) throw new Error(agreementsError.message ?? 'Failed to load plan agreements')

  const eventIds = Array.from(new Set(
    ((agreements ?? []) as Array<{ event_id?: string | null }>)
      .map((agreement) => agreement.event_id)
      .filter((eventId): eventId is string => Boolean(eventId))
  ))
  if (eventIds.length === 0) return null

  const { data, error } = await (admin as any)
    .from('external_event_integrations')
    .select('platform, external_event_id, access_token_encrypted, api_key_encrypted, config')
    .in('event_id', eventIds)
    .in('platform', ['eventbrite', 'luma'])
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message ?? 'Failed to load ticketing integration')
  return normalizeIntegrationCandidate(((data ?? []) as Array<Record<string, unknown>>)[0])
}

async function loadMatchedEventIntegration(
  admin: SupabaseClient,
  plan: PlanRow,
  builderId: string
): Promise<IntegrationCandidate | null> {
  const { data: events, error: eventsError } = await (admin as any)
    .from('events')
    .select('id, event_name, event_date')
    .eq('builder_id', builderId)
    .order('event_date', { ascending: false })
    .limit(25)

  if (eventsError) throw new Error(eventsError.message ?? 'Failed to load builder events')

  const matchedEventIds = ((events ?? []) as Array<{ id: string; event_name?: string | null; event_date?: string | null }>)
    .filter((event) => isLikelySameEvent(plan, event))
    .map((event) => event.id)
  if (matchedEventIds.length === 0) return null

  const { data, error } = await (admin as any)
    .from('external_event_integrations')
    .select('platform, external_event_id, access_token_encrypted, api_key_encrypted, config')
    .in('event_id', matchedEventIds)
    .in('platform', ['eventbrite', 'luma'])
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message ?? 'Failed to load matched ticketing integration')
  return normalizeIntegrationCandidate(((data ?? []) as Array<Record<string, unknown>>)[0])
}

async function loadBuilderTicketingConnections(
  admin: SupabaseClient,
  builderId: string
): Promise<BuilderTicketingConnectionRow[]> {
  const { data, error } = await (admin as any)
    .from('builder_ticketing_connections')
    .select('platform, access_token_encrypted, config')
    .eq('builder_id', builderId)
    .in('platform', ['eventbrite', 'luma'])

  if (error) throw new Error(error.message ?? 'Failed to load ticketing connections')
  return (data ?? []) as BuilderTicketingConnectionRow[]
}

function normalizeIntegrationCandidate(row: Record<string, unknown> | undefined): IntegrationCandidate | null {
  if (!row || (row.platform !== 'eventbrite' && row.platform !== 'luma')) return null

  return {
    platform: row.platform,
    external_event_id: typeof row.external_event_id === 'string' ? row.external_event_id : null,
    access_token_encrypted: typeof row.access_token_encrypted === 'string' ? row.access_token_encrypted : null,
    api_key_encrypted: typeof row.api_key_encrypted === 'string' ? row.api_key_encrypted : null,
    config: asRecord(row.config),
  }
}

function readExternalEventId(candidate: IntegrationCandidate) {
  const config = candidate.config ?? {}
  return candidate.external_event_id ??
    readString(config.external_event_id) ??
    readString(config.eventbrite_event_id) ??
    readString(config.event_api_id) ??
    readString(config.luma_event_api_id) ??
    readString(config.event_id) ??
    null
}

function readEventbriteAccessToken(
  candidate: IntegrationCandidate,
  connections: BuilderTicketingConnectionRow[]
) {
  const candidateToken = candidate.access_token_encrypted ?? readString(candidate.encrypted_credentials?.access_token)
  if (candidateToken) return safeDecrypt(candidateToken)

  const accountConnection = connections.find((connection) => connection.platform === 'eventbrite')
  return accountConnection?.access_token_encrypted ? safeDecrypt(accountConnection.access_token_encrypted) : null
}

function readLumaApiKey(candidate: IntegrationCandidate) {
  const encrypted = candidate.api_key_encrypted ?? readString(candidate.encrypted_credentials?.api_key)
  if (encrypted) return safeDecrypt(encrypted)
  return process.env.LUMA_API_KEY || null
}

function isLikelySameEvent(
  plan: PlanRow,
  event: { event_name?: string | null; event_date?: string | null }
) {
  const planDate = normalizeDate(plan.date_window_start)
  const eventDate = normalizeDate(event.event_date)
  const dateMatches = Boolean(planDate && eventDate && planDate === eventDate)
  const titleMatches = normalizeTitle(plan.title) && normalizeTitle(plan.title) === normalizeTitle(event.event_name)

  return dateMatches || Boolean(titleMatches)
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function normalizeTitle(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function unavailable(
  source: AttendancePollResult['source'],
  error: string
): AttendancePollResult {
  return {
    source,
    attendance_count: null,
    count_type: 'unavailable',
    confidence: 'low',
    pulled_at: new Date().toISOString(),
    error,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeDecrypt(value: string) {
  try {
    return decryptSecret(value)
  } catch {
    return value
  }
}

function isMissingTableError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message)
      : String(error)

  return /relation .* does not exist|schema cache|provider_connections/i.test(message)
}
