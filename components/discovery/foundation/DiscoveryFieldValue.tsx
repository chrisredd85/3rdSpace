import type { ReactNode } from 'react'
import type { DiscoveryFieldState } from '@/lib/discovery/foundation/reader'

/** Dormant presentation primitive. No existing display imports it in Gate A. */
export function DiscoveryFieldValue({
  label,
  field,
  renderValue,
}: {
  label: string
  field: DiscoveryFieldState
  renderValue?: (value: Extract<DiscoveryFieldState, { status: 'available' }>['value']) => ReactNode
}) {
  if (field.status === 'unavailable') {
    return <span aria-label={`${label}: unavailable`} className="text-muted-foreground">Unavailable</span>
  }
  const value = renderValue ? renderValue(field.value)
    : typeof field.value === 'boolean' ? (field.value ? 'Yes' : 'No')
      : Array.isArray(field.value) ? (field.value.length ? field.value.join(', ') : 'None') : String(field.value)
  return <span aria-label={label}>{value}</span>
}
