import type { Plan, VendorNeedStatus } from '@/lib/types/planner'

export const VENDOR_NEED_STATUS_METADATA_KEY = 'vendor_need_status'

export const VENDOR_NEED_STATUSES: readonly VendorNeedStatus[] = [
  'none',
  'optional',
  'required',
  'unknown',
]

export function normalizeVendorNeedStatus(value: unknown): VendorNeedStatus | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'not_needed' || normalized === 'no_vendors' || normalized === 'none_needed') return 'none'
  if (normalized === 'need_vendors' || normalized === 'vendors_required') return 'required'
  return VENDOR_NEED_STATUSES.includes(normalized as VendorNeedStatus)
    ? normalized as VendorNeedStatus
    : null
}

export function readVendorNeedStatusFromMetadata(metadata: unknown): VendorNeedStatus {
  const record = readRecord(metadata)
  return normalizeVendorNeedStatus(record?.[VENDOR_NEED_STATUS_METADATA_KEY]) ?? 'unknown'
}

export function readPlanVendorNeedStatus(plan: Pick<Plan, 'metadata'>): VendorNeedStatus {
  return readVendorNeedStatusFromMetadata(plan.metadata)
}

export function mergeVendorNeedStatusMetadata(
  metadata: unknown,
  status: unknown
): Record<string, unknown> | null {
  const normalized = normalizeVendorNeedStatus(status)
  if (!normalized) return null
  return {
    ...(readRecord(metadata) ?? {}),
    [VENDOR_NEED_STATUS_METADATA_KEY]: normalized,
  }
}

export function resolveVendorNeedStatusUpdate(input: {
  metadata: unknown
  userMessage: string
  agentStatus: unknown
}): VendorNeedStatus | null {
  const detected = detectVendorNeedStatusFromText(input.userMessage)
  if (detected) return detected

  const normalizedAgentStatus = normalizeVendorNeedStatus(input.agentStatus)
  if (normalizedAgentStatus && normalizedAgentStatus !== 'unknown') return normalizedAgentStatus

  return readVendorNeedStatusFromMetadata(input.metadata) === 'unknown' && normalizedAgentStatus === 'unknown'
    ? 'unknown'
    : null
}

export function detectVendorNeedStatusFromText(text: string): VendorNeedStatus | null {
  const normalized = text.toLowerCase()

  if (
    /\b(no|don't|do not|dont|won't|will not)\s+(need|want|use|source|book|hire)\s+(any\s+)?(outside\s+)?vendors?\b/.test(normalized) ||
    /\b(no|without)\s+(outside\s+)?vendors?\b/.test(normalized) ||
    /\bno\s+(caterer|catering|dj|photographer|videographer|av|a\/v|security|check[-\s]?in|bartender|staff|staffing)\b/.test(normalized) ||
    /\b(no|skip)\s+(photo|video|av|a\/v|security|check[-\s]?in|bar|catering|food|vendors?)\b/.test(normalized) ||
    /\b(venue|space|bar|restaurant)\s+(handles|provides|covers|includes)\s+(everything|all|food|catering|bar|drinks|av|a\/v|security|staff|staffing|check[-\s]?in)\b/.test(normalized) ||
    /\b(we|i|host|organizer)\s+(already\s+)?(have|bring|provide|cover|handle)\s+(everything|all\s+vendors|our\s+own\s+vendors|my\s+own\s+vendors|the\s+vendors)\b/.test(normalized)
  ) {
    return 'none'
  }

  if (
    /\b(vendors?\s+(are\s+)?optional|optional\s+vendors?|nice[-\s]?to[-\s]?have\s+vendors?)\b/.test(normalized) ||
    /\bmaybe\s+(a\s+)?(vendor|dj|photographer|caterer|av|a\/v|security|bartender)\b/.test(normalized)
  ) {
    return 'optional'
  }

  if (
    /\b(need|want|source|book|hire|find)\s+(a\s+|an\s+|some\s+|outside\s+)?(vendor|vendors|caterer|catering|dj|photographer|videographer|av|a\/v|security|bartender|staff|staffing|decor)\b/.test(normalized) ||
    /\b(vendor|caterer|dj|photographer|videographer|av|a\/v|security|bartender|staffing)\s+(needed|required)\b/.test(normalized)
  ) {
    return 'required'
  }

  return null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
