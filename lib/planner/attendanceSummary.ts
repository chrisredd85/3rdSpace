export interface PlanAttendanceSnapshot {
  ticketsSold: number | null
  currentAttendance: number | null
  checkedIn: number | null
  ticketsRefunded: number | null
  sourceLabel: string | null
  updatedAt: string | null
}

const countKeys = {
  ticketsSold: [
    'ticketsSold',
    'tickets_sold',
    'ticket_count',
    'tickets_count',
    'sold',
    'rsvps_or_imported_attendees',
  ],
  currentAttendance: [
    'currentAttendance',
    'current_attendance',
    'confirmed',
    'confirmed_attendance',
    'attendance_count',
    'active_tickets',
    'activeTickets',
  ],
  checkedIn: [
    'checkedIn',
    'checked_in',
    'checked_in_count',
    'tickets_checked_in',
    'ticketsCheckedIn',
    'attendees_checked_in',
    'total_checked_in',
  ],
  ticketsRefunded: [
    'ticketsRefunded',
    'tickets_refunded',
    'refunded',
  ],
} as const

const sourceKeys = [
  'sourceLabel',
  'source_label',
  'source',
  'provider',
  'platform',
  'data_source',
  'collection_method',
] as const

const sourceArrayKeys = [
  'data_sources',
  'connected_platforms',
] as const

const updatedAtKeys = [
  'updatedAt',
  'updated_at',
  'lastEventAt',
  'last_event_at',
  'last_sync_at',
  'last_checked_at',
  'calculated_at',
] as const

const nestedKeys = [
  'attendance',
  'attendanceSummary',
  'attendance_summary',
  'ticketing',
  'ticketingSummary',
  'ticketing_summary',
  'eventActuals',
  'event_actuals',
  'actuals',
  'pnl',
  'revenue',
  'summary',
  'kpis',
  'signals',
  'freshness',
] as const

export function emptyPlanAttendanceSnapshot(): PlanAttendanceSnapshot {
  return {
    ticketsSold: null,
    currentAttendance: null,
    checkedIn: null,
    ticketsRefunded: null,
    sourceLabel: null,
    updatedAt: null,
  }
}

export function normalizePlanAttendanceSnapshot(...sources: unknown[]): PlanAttendanceSnapshot {
  const candidates = collectCandidateRecords(sources)

  return {
    ticketsSold: firstCount(candidates, countKeys.ticketsSold),
    currentAttendance: firstCount(candidates, countKeys.currentAttendance),
    checkedIn: firstCount(candidates, countKeys.checkedIn),
    ticketsRefunded: firstCount(candidates, countKeys.ticketsRefunded),
    sourceLabel: firstSourceLabel(candidates),
    updatedAt: firstString(candidates, updatedAtKeys),
  }
}

export function hasAttendanceSignal(snapshot: PlanAttendanceSnapshot | null | undefined) {
  return Boolean(
    snapshot &&
    (
      snapshot.ticketsSold !== null ||
      snapshot.currentAttendance !== null ||
      snapshot.checkedIn !== null ||
      snapshot.ticketsRefunded !== null
    )
  )
}

function collectCandidateRecords(sources: unknown[]) {
  const candidates: Record<string, unknown>[] = []
  const visited = new Set<unknown>()

  for (const source of sources) collect(source, 0)

  return candidates

  function collect(value: unknown, depth: number) {
    if (depth > 3 || visited.has(value)) return
    const record = asRecord(value)
    if (!record) return

    visited.add(value)
    candidates.push(record)

    for (const key of nestedKeys) {
      collect(record[key], depth + 1)
    }
  }
}

function firstCount(candidates: Record<string, unknown>[], keys: readonly string[]) {
  for (const record of candidates) {
    for (const key of keys) {
      const value = readCount(record[key])
      if (value !== null) return value
    }
  }

  return null
}

function firstSourceLabel(candidates: Record<string, unknown>[]) {
  const scalarSource = firstString(candidates, sourceKeys)
  if (scalarSource) return titleizeSourceLabel(scalarSource)

  for (const record of candidates) {
    for (const key of sourceArrayKeys) {
      const values = readStringArray(record[key])
      if (values.length > 0) return values.map(titleizeSourceLabel).join(', ')
    }
  }

  return null
}

function firstString(candidates: Record<string, unknown>[], keys: readonly string[]) {
  for (const record of candidates) {
    for (const key of keys) {
      const value = readString(record[key])
      if (value) return value
    }
  }

  return null
}

function readCount(value: unknown) {
  const number = readNumber(value)
  if (number === null || number < 0) return null
  return Math.floor(number)
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = readString(item)
    return text ? [text] : []
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function titleizeSourceLabel(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.length <= 4 && part.toUpperCase() === part
      ? part
      : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}
