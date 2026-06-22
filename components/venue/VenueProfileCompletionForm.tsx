'use client'

import { useState, useTransition } from 'react'
import type { InputHTMLAttributes } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type VenueProfileCompletionFormProps = {
  opportunityToken: string | null
  initialValues: {
    venueName: string
    address: string
    city: string
    state: string
    zipCode: string
    capacity: number | null
    venueType: string
    contactEmail: string
  }
}

export function VenueProfileCompletionForm({
  opportunityToken,
  initialValues,
}: VenueProfileCompletionFormProps) {
  const router = useRouter()
  const [venueName, setVenueName] = useState(initialValues.venueName)
  const [address, setAddress] = useState(initialValues.address)
  const [city, setCity] = useState(initialValues.city)
  const [state, setState] = useState(initialValues.state)
  const [zipCode, setZipCode] = useState(initialValues.zipCode)
  const [capacity, setCapacity] = useState(initialValues.capacity ? String(initialValues.capacity) : '')
  const [venueType, setVenueType] = useState(initialValues.venueType)
  const [contactEmail, setContactEmail] = useState(initialValues.contactEmail)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canSubmit = Boolean(
    venueName.trim() &&
    address.trim() &&
    city.trim() &&
    /^[A-Za-z]{2}$/.test(state.trim()) &&
    zipCode.trim().length >= 5 &&
    Number(capacity) > 0
  )

  function submit() {
    setError(null)
    startTransition(async () => {
      const response = await fetch('/api/venue/profile/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityToken,
          venueName,
          address,
          city,
          state,
          zipCode,
          capacity: Number(capacity),
          venueType: venueType || null,
          contactEmail: contactEmail || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error || 'Could not update the venue profile.')
        return
      }

      router.push(payload.redirectTo || '/venue/payouts')
    })
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center">
        <section className="w-full rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
          <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Venue profile
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold">Confirm venue details</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            These details let the organizer confirm terms and make sure payout setup is tied to the correct venue.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field label="Venue name" value={venueName} onChange={setVenueName} />
            <Field label="Venue type" value={venueType} onChange={setVenueType} placeholder="Bar, cafe, gallery..." />
            <Field label="Address" value={address} onChange={setAddress} className="sm:col-span-2" />
            <Field label="City" value={city} onChange={setCity} />
            <Field label="State" value={state} onChange={setState} maxLength={2} />
            <Field label="ZIP code" value={zipCode} onChange={setZipCode} />
            <Field label="Standing capacity" value={capacity} onChange={setCapacity} inputMode="numeric" />
            <Field label="Booking contact email" value={contactEmail} onChange={setContactEmail} type="email" className="sm:col-span-2" />
          </div>

          {error ? (
            <div className="mt-5 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-foreground">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex justify-end">
            <Button type="button" onClick={submit} disabled={!canSubmit || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue to payout setup
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </div>
    </main>
  )
}

function Field({
  label,
  value,
  onChange,
  className,
  ...inputProps
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className={className}>
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      <Input
        {...inputProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2"
      />
    </label>
  )
}
