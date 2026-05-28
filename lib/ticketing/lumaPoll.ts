import 'server-only'

export type LumaAttendancePollInput = {
  apiKey: string
  eventApiId: string
}

export type LumaAttendancePollOutput = {
  rsvpCount: number
  rawResponse: {
    event: unknown
    guests: unknown
  }
}

export async function pollLumaRsvpCount({
  apiKey,
  eventApiId,
}: LumaAttendancePollInput): Promise<LumaAttendancePollOutput> {
  const event = await lumaFetch(`https://api.lu.ma/public/v1/event/get?event_api_id=${encodeURIComponent(eventApiId)}`, apiKey)
  const guests = await lumaFetch<{ entries?: unknown[]; guests?: unknown[] }>(
    `https://api.lu.ma/public/v1/event/get-guests?event_api_id=${encodeURIComponent(eventApiId)}`,
    apiKey
  )
  const guestRows = Array.isArray(guests.entries)
    ? guests.entries
    : Array.isArray(guests.guests)
      ? guests.guests
      : []

  return {
    rsvpCount: guestRows.filter(isApprovedGuest).length,
    rawResponse: {
      event,
      guests,
    },
  }
}

async function lumaFetch<T = unknown>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-luma-api-key': apiKey,
    },
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(data?.message ?? data?.error ?? 'Luma request failed')
  }

  return data as T
}

function isApprovedGuest(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const guest = typeof row.guest === 'object' && row.guest !== null
    ? row.guest as Record<string, unknown>
    : row
  const approvalStatus = String(
    guest.approval_status ?? row.approval_status ?? guest.status ?? row.status ?? ''
  ).toLowerCase()

  return approvalStatus === 'approved' || approvalStatus === 'going'
}
