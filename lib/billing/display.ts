export type FreeEventUsageInput = {
  freeEventsGranted?: number | null
  freeEventsUsed?: number | null
  freeEventsRemaining?: number | null
}

export type FreeEventUsageDisplay = {
  granted: number
  used: number
  remaining: number
  rawUsed: number
  hasOverage: boolean
}

export function getFreeEventUsageDisplay(input: FreeEventUsageInput): FreeEventUsageDisplay {
  const granted = clampNonNegative(input.freeEventsGranted ?? 0)
  const rawUsed = clampNonNegative(input.freeEventsUsed ?? 0)
  const used = granted > 0 ? Math.min(rawUsed, granted) : rawUsed
  const derivedRemaining = Math.max(granted - used, 0)
  const apiRemaining = clampNonNegative(input.freeEventsRemaining ?? derivedRemaining)
  const remaining = Math.min(apiRemaining, derivedRemaining)

  return {
    granted,
    used,
    remaining,
    rawUsed,
    hasOverage: rawUsed > granted,
  }
}

function clampNonNegative(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(Math.floor(value), 0)
}
