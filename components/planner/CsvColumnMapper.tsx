'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type CsvKind = 'attendees' | 'sales'

type CsvMappingPayload = {
  mapping: Record<string, string>
  candidates?: Record<string, string[]>
  missingRequired?: string[]
  ambiguousFields?: string[]
}

type CsvColumnMapperProps = {
  kind: CsvKind
  headers: string[]
  mapping: CsvMappingPayload
  isSubmitting?: boolean
  onSubmit: (mapping: Record<string, string>) => void
}

const attendeeFields = [
  ['external_attendee_id', 'Attendee ID'],
  ['full_name', 'Full name'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['email', 'Email'],
  ['ticket_type', 'Ticket type'],
  ['order_id', 'Order ID'],
  ['checked_in', 'Checked in'],
  ['check_in_time', 'Check-in time'],
  ['ticket_price', 'Ticket price'],
]

const salesFields = [
  ['order_id', 'Order ID'],
  ['buyer_name', 'Buyer name'],
  ['buyer_email', 'Buyer email'],
  ['ticket_quantity', 'Quantity'],
  ['ticket_type', 'Ticket type'],
  ['ticket_price', 'Ticket price'],
  ['total_amount', 'Total amount'],
  ['fees', 'Fees'],
  ['currency', 'Currency'],
  ['discount_code', 'Discount code'],
  ['is_refund', 'Refund status'],
  ['purchase_timestamp', 'Purchase time'],
]

export function CsvColumnMapper({
  kind,
  headers,
  mapping,
  isSubmitting = false,
  onSubmit,
}: CsvColumnMapperProps) {
  const fields = kind === 'attendees' ? attendeeFields : salesFields
  const [draftMapping, setDraftMapping] = useState<Record<string, string>>(() => mapping.mapping ?? {})
  const requiredFields = useMemo(() => new Set(mapping.missingRequired ?? []), [mapping.missingRequired])
  const ambiguousFields = useMemo(() => new Set(mapping.ambiguousFields ?? []), [mapping.ambiguousFields])

  return (
    <div className="rounded-md border border-amber-600/30 bg-amber-50 p-4 text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            <h3 className="font-display text-lg font-semibold">Map CSV columns</h3>
          </div>
          <p className="mt-1 text-sm text-amber-900">
            Confirm the fields 3rdPlace needs before importing this file.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => onSubmit(draftMapping)} disabled={isSubmitting}>
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Apply mapping
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {fields.map(([field, label]) => {
          const needsAttention = requiredFields.has(field) || ambiguousFields.has(field)
          return (
            <div key={field} className="space-y-1">
              <Label htmlFor={`${kind}-${field}`} className={cn(needsAttention && 'text-amber-950')}>
                {label}
              </Label>
              <select
                id={`${kind}-${field}`}
                value={draftMapping[field] ?? ''}
                onChange={(event) => setDraftMapping((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))}
                className={cn(
                  'flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  needsAttention ? 'border-amber-700' : 'border-input'
                )}
              >
                <option value="">Not mapped</option>
                {headers.map((header) => (
                  <option key={`${field}-${header}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
