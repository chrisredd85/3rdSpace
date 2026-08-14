import 'server-only'

import * as Sentry from '@sentry/nextjs'

import type { Json } from '@/lib/types'
import {
  searchGooglePlacesText,
  type GooglePlaceCandidate,
} from '@/lib/server/google-places-client'
import {
  cascadeInvalidationForEntityChange,
  type DiscoveryCascadeImpact,
  type DiscoveryEntityType,
} from '@/lib/discovery/cascadeInvalidation'
import { PLACES_REFRESH_CHANGE_SOURCE } from '@/lib/discovery/changeLogSources'
import type { SupabaseAdminClient } from '@/lib/planner/planRevisions'

export type DiscoveryRefreshResult = {
  entity_type: DiscoveryEntityType
  entity_id: string
  changes_detected: number
  applied_changes: string[]
  cascade_impact: DiscoveryCascadeImpact
}

type RefreshInput = {
  supabase: SupabaseAdminClient
  entityType: DiscoveryEntityType
  entityId: string
  apiKey: string
  actorId?: string | null
}

type RefreshRow = Record<string, unknown> & {
  id: string
  source_external_id?: string | null
  google_place_id?: string | null
  name?: string | null
  address?: string | null
  formatted_address?: string | null
  city?: string | null
  website?: string | null
}

type Change = {
  field: string
  oldValue: unknown
  newValue: unknown
  confidence: number
  autoApply: boolean
  cascade: boolean
  evidence: string
}

const EMPTY_IMPACT: DiscoveryCascadeImpact = {
  invalidated_recommendation_ids: [],
  flagged_commitment_ids: [],
  superseded_outreach_thread_ids: [],
  notifications_to_send: [],
}

const CASCADE_FIELDS = new Set([
  'name',
  'address',
  'formatted_address',
  'city',
  'contact_phone',
  'phone',
  'website',
  'business_status',
])

export async function refreshDiscoveryEntityFromPlaces(input: RefreshInput): Promise<DiscoveryRefreshResult> {
  const row = await loadDiscoveryRow(input.supabase, input.entityType, input.entityId)
  if (!row) throw new Error(`Discovery entity not found: ${input.entityType}:${input.entityId}`)

  const match = await fetchMatchingPlace(input.apiKey, input.entityType, row)
  if (!match) {
    await updateRefreshStatus(input.supabase, input.entityType, input.entityId, {
      last_places_refresh_at: new Date().toISOString(),
      data_freshness_status: 'stale',
    })
    return {
      entity_type: input.entityType,
      entity_id: input.entityId,
      changes_detected: 0,
      applied_changes: [],
      cascade_impact: EMPTY_IMPACT,
    }
  }

  const changes = detectChanges(input.entityType, row, match)
  const appliedChanges = changes.filter((change) => change.autoApply)
  let mergedImpact = EMPTY_IMPACT

  for (const change of changes) {
    const logId = await insertChangeLog(input.supabase, {
      entityType: input.entityType,
      entityId: input.entityId,
      change,
      actorId: input.actorId,
      applied: change.autoApply,
    })

    if (!change.autoApply) continue

    await applyFieldChange(input.supabase, input.entityType, input.entityId, change)

    if (change.cascade) {
      const impact = await cascadeInvalidationForEntityChange({
        supabase: input.supabase,
        entityType: input.entityType,
        entityId: input.entityId,
        changedField: change.field,
        newValue: change.newValue,
        actorId: input.actorId,
      })
      mergedImpact = mergeImpact(mergedImpact, impact)
      if (logId) {
        await input.supabase
          .from('discovery_change_log')
          .update({ cascade_impact: impact as unknown as Json })
          .eq('id', logId)
      }
    }
  }

  const now = new Date().toISOString()
  await updateRefreshStatus(input.supabase, input.entityType, input.entityId, {
    last_places_refresh_at: now,
    last_meaningful_change_at: appliedChanges.length > 0 ? now : row.last_meaningful_change_at ?? null,
    data_freshness_status: deriveFreshnessStatus(changes, match.businessStatus),
  })

  return {
    entity_type: input.entityType,
    entity_id: input.entityId,
    changes_detected: changes.length,
    applied_changes: appliedChanges.map((change) => change.field),
    cascade_impact: mergedImpact,
  }
}

async function loadDiscoveryRow(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string
): Promise<RefreshRow | null> {
  const table = tableForEntity(entityType)
  const { data, error } = await db
    .from(table)
    .select('*')
    .eq('id', entityId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load ${table}: ${error.message}`)
  return (data as RefreshRow | null) ?? null
}

async function fetchMatchingPlace(
  apiKey: string,
  entityType: DiscoveryEntityType,
  row: RefreshRow
): Promise<GooglePlaceCandidate | null> {
  const textQuery = buildRefreshQuery(entityType, row)
  const city = readString(row.city)
  const result = await searchGooglePlacesText({
    apiKey,
    textQuery,
    city,
    neighborhood: city,
    maxResultCount: 5,
  })
  const expectedPlaceId = readString(row.google_place_id) ?? readString(row.source_external_id)
  const exact = expectedPlaceId
    ? result.places.find((place) => place.id === expectedPlaceId || place.id.endsWith(`/${expectedPlaceId}`))
    : null
  return exact ?? result.places[0] ?? null
}

function detectChanges(entityType: DiscoveryEntityType, row: RefreshRow, place: GooglePlaceCandidate): Change[] {
  const common = [
    buildChange('name', row.name, place.displayName.text, 0.95, false),
    buildChange(entityType === 'discovery_venue' ? 'address' : 'formatted_address', entityType === 'discovery_venue' ? row.address : row.formatted_address, place.formattedAddress ?? null, 0.95, true),
    buildChange(entityType === 'discovery_venue' ? 'contact_phone' : 'phone', entityType === 'discovery_venue' ? row.contact_phone : row.phone, place.nationalPhoneNumber ?? null, 0.9, true),
    buildChange('website', row.website, place.websiteUri ?? null, 0.9, true),
    buildChange('business_status', row.business_status, place.businessStatus ?? null, 0.98, true),
  ]

  const ratingFields = entityType === 'discovery_venue'
    ? [
      buildChange('google_rating', row.google_rating, place.rating ?? null, 0.85, true, false),
      buildChange('google_user_ratings_total', row.google_user_ratings_total, place.userRatingCount ?? null, 0.85, true, false),
    ]
    : [
      buildChange('google_rating', row.google_rating, place.rating ?? null, 0.85, true, false),
      buildChange('google_user_rating_count', row.google_user_rating_count, place.userRatingCount ?? null, 0.85, true, false),
      buildChange('google_price_level', row.google_price_level, place.priceLevel ?? null, 0.8, true, false),
      buildChange('place_types', row.place_types, place.types ?? [], 0.8, true, false),
    ]

  return [...common, ...ratingFields].filter((change): change is Change => change !== null)
}

function buildChange(
  field: string,
  oldValue: unknown,
  newValue: unknown,
  confidence: number,
  autoApply: boolean,
  cascade = CASCADE_FIELDS.has(field)
): Change | null {
  if (normalizeComparable(oldValue) === normalizeComparable(newValue)) return null
  if (newValue === undefined || newValue === '') return null
  return {
    field,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    confidence,
    autoApply,
    cascade,
    evidence: `Google Places refresh detected ${field} change.`,
  }
}

async function applyFieldChange(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string,
  change: Change
) {
  const table = tableForEntity(entityType)
  const { error } = await db
    .from(table)
    .update({
      [change.field]: change.newValue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entityId)

  if (error) {
    console.error('[discovery.refresh] field_update_failed', {
      table,
      entity_id: entityId,
      field: change.field,
      error: error.message,
    })
  }
}

async function insertChangeLog(
  db: SupabaseAdminClient,
  input: {
    entityType: DiscoveryEntityType
    entityId: string
    change: Change
    actorId?: string | null
    applied: boolean
  }
): Promise<string | null> {
  const { data, error } = await db
    .from('discovery_change_log')
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      source: PLACES_REFRESH_CHANGE_SOURCE,
      field_name: input.change.field,
      old_value: toJson(input.change.oldValue),
      new_value: toJson(input.change.newValue),
      confidence: input.change.confidence,
      source_evidence: input.change.evidence,
      actor_id: input.actorId ?? null,
      applied: input.applied,
      applied_at: input.applied ? new Date().toISOString() : null,
      cascade_impact: EMPTY_IMPACT as unknown as Json,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[discovery.refresh] change_log_insert_failed', {
      entity_type: input.entityType,
      entity_id: input.entityId,
      field: input.change.field,
      error: error.message,
    })

    if (isConstraintViolation(error)) {
      Sentry.captureMessage('discovery_change_log_constraint', {
        level: 'error',
        tags: {
          alert_class: 'discovery_change_log_constraint',
          postgres_code: error.code ?? 'unknown',
        },
        extra: {
          entity_type: input.entityType,
          entity_id: input.entityId,
          field: input.change.field,
          source: PLACES_REFRESH_CHANGE_SOURCE,
          error: error.message,
        },
      })
    }
    return null
  }

  return data?.id ? String(data.id) : null
}

function isConstraintViolation(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code?.startsWith('23')) return true
  return /constraint/i.test(error.message ?? '')
}

async function updateRefreshStatus(
  db: SupabaseAdminClient,
  entityType: DiscoveryEntityType,
  entityId: string,
  updates: Record<string, unknown>
) {
  const { error } = await db
    .from(tableForEntity(entityType))
    .update(updates)
    .eq('id', entityId)

  if (error) console.error('[discovery.refresh] status_update_failed', error)
}

function buildRefreshQuery(entityType: DiscoveryEntityType, row: RefreshRow): string {
  const name = readString(row.name) ?? 'venue'
  const address = entityType === 'discovery_venue'
    ? readString(row.address)
    : readString(row.formatted_address)
  const city = readString(row.city)
  return [name, address, city].filter(Boolean).join(' ')
}

function deriveFreshnessStatus(changes: Change[], businessStatus: string | undefined): string {
  if (businessStatus && businessStatus !== 'OPERATIONAL') return 'closed'
  if (changes.some((change) => change.autoApply)) return 'changed'
  if (changes.length > 0) return 'under_review'
  return 'fresh'
}

function tableForEntity(entityType: DiscoveryEntityType): 'discovery_venues' | 'discovery_vendors' {
  return entityType === 'discovery_venue' ? 'discovery_venues' : 'discovery_vendors'
}

function mergeImpact(left: DiscoveryCascadeImpact, right: DiscoveryCascadeImpact): DiscoveryCascadeImpact {
  return {
    invalidated_recommendation_ids: uniqueStrings([...left.invalidated_recommendation_ids, ...right.invalidated_recommendation_ids]),
    flagged_commitment_ids: uniqueStrings([...left.flagged_commitment_ids, ...right.flagged_commitment_ids]),
    superseded_outreach_thread_ids: uniqueStrings([...left.superseded_outreach_thread_ids, ...right.superseded_outreach_thread_ids]),
    notifications_to_send: [...left.notifications_to_send, ...right.notifications_to_send],
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

function normalizeComparable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(String).sort())
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000)
  return String(value).trim().toLowerCase()
}

function toJson(value: unknown): Json {
  if (value === undefined) return null
  return value as Json
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
