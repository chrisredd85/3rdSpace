import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type BaselineSource = 'personal' | 'archetype' | 'default'

export type ProjectionBaseline = {
  source: BaselineSource
  avgSellThrough: number
  avgNoShowRate: number
  avgAttendanceRate: number
  avgMarginCents: number | null
  stddevMarginCents: number | null
  nEvents: number
  basisLabel: string
}

export const DEFAULT_SELL_THROUGH = 0.85
export const DEFAULT_NO_SHOW = 0.15
export const DEFAULT_ATTENDANCE = 0.85

const defaultBaseline: ProjectionBaseline = {
  source: 'default',
  avgSellThrough: DEFAULT_SELL_THROUGH,
  avgNoShowRate: DEFAULT_NO_SHOW,
  avgAttendanceRate: DEFAULT_ATTENDANCE,
  avgMarginCents: null,
  stddevMarginCents: null,
  nEvents: 0,
  basisLabel: 'Industry default',
}

type BaselineRow = {
  n_events: number | null
  avg_sell_through: number | string | null
  avg_no_show_rate: number | string | null
  avg_attendance_rate: number | string | null
  avg_margin_cents: number | null
  stddev_margin_cents: number | null
}

type PlannerBaselineClient = Pick<SupabaseClient<any, 'public', any>, 'from'>

export async function lookupBaseline(
  supabase: PlannerBaselineClient,
  params: {
    organizerId: string
    archetype: string | null | undefined
    neighborhood: string | null | undefined
  }
): Promise<ProjectionBaseline> {
  const archetype = normalizeBaselineDimension(params.archetype, 'event')
  const neighborhood = normalizeBaselineDimension(params.neighborhood, 'bay_area')

  const personal = await querySingleBaseline(
    supabase,
    'organizer_baselines',
    (query) => query.eq('organizer_id', params.organizerId).eq('archetype', archetype)
  )
  if (personal) return mapBaselineRow(personal, 'personal')

  const archetypeBaseline = await querySingleBaseline(
    supabase,
    'archetype_baselines',
    (query) => query.eq('archetype', archetype).eq('neighborhood', neighborhood)
  )
  if (archetypeBaseline) return mapBaselineRow(archetypeBaseline, 'archetype')

  return defaultBaseline
}

export function formatBasisLabel(baseline: Pick<ProjectionBaseline, 'source' | 'nEvents'>) {
  if (baseline.source === 'personal') {
    return `Based on your last ${baseline.nEvents} event${baseline.nEvents === 1 ? '' : 's'}`
  }
  if (baseline.source === 'archetype') {
    return `Based on ${baseline.nEvents} similar event${baseline.nEvents === 1 ? '' : 's'}`
  }
  return 'Industry default'
}

export function normalizeBaselineDimension(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || fallback
}

async function querySingleBaseline(
  supabase: PlannerBaselineClient,
  table: 'organizer_baselines' | 'archetype_baselines',
  scope: (query: any) => any
): Promise<BaselineRow | null> {
  const query = scope(
    supabase
      .from(table)
      .select('n_events, avg_sell_through, avg_no_show_rate, avg_attendance_rate, avg_margin_cents, stddev_margin_cents')
  )
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.warn('[planner.baselines] Baseline lookup failed', { table, message: error.message })
    return null
  }
  return data as BaselineRow | null
}

function mapBaselineRow(row: BaselineRow, source: Exclude<BaselineSource, 'default'>): ProjectionBaseline {
  const baseline = {
    source,
    avgSellThrough: readRate(row.avg_sell_through, DEFAULT_SELL_THROUGH),
    avgNoShowRate: readRate(row.avg_no_show_rate, DEFAULT_NO_SHOW),
    avgAttendanceRate: readRate(row.avg_attendance_rate, DEFAULT_ATTENDANCE),
    avgMarginCents: row.avg_margin_cents ?? null,
    stddevMarginCents: row.stddev_margin_cents ?? null,
    nEvents: Math.max(0, Math.floor(row.n_events ?? 0)),
  }
  return {
    ...baseline,
    basisLabel: formatBasisLabel(baseline),
  }
}

function readRate(value: number | string | null, fallback: number) {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1.5, Math.max(0, parsed as number))
}
