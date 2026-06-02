'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Plus, RefreshCw, Search, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type SupplyScoutLead = {
  id: string
  name: string
  address: string
  neighborhood: string | null
  city: string
  state: string
  source_platform: string
  source_url: string | null
  event_title: string | null
  event_type: string | null
  evidence_summary: string
  booking_signals: string[]
  disqualifiers: string[]
  website: string | null
  capacity_hint: number | null
  price_hint_cents_low: number | null
  price_hint_cents_high: number | null
  booking_likelihood: 'public_bookable' | 'commercial_likely_bookable' | 'event_proven_unverified' | 'not_suitable'
  confidence: number
  review_status: 'needs_review' | 'approved' | 'rejected' | 'duplicate'
  discovery_venue_id: string | null
  updated_at: string
  created_at: string
}

type SupplyScoutCounts = {
  total: number
  needs_review: number
  approved: number
  rejected: number
  duplicate: number
}

type SupplyScoutConsoleProps = {
  initialLeads: SupplyScoutLead[]
}

type FormState = Record<string, string>

const TARGET_APPROVED = 150
const sourcePlatforms = ['posh', 'eventbrite', 'partiful', 'luma', 'google_search', 'city_source', 'reddit', 'manual', 'other']
const reviewStatuses = ['all', 'needs_review', 'approved', 'duplicate', 'rejected'] as const

/**
 * Admin-only Supply Scout console for capturing and approving venue address leads.
 */
export function SupplyScoutConsole({ initialLeads }: SupplyScoutConsoleProps) {
  const [leads, setLeads] = useState(initialLeads)
  const [statusFilter, setStatusFilter] = useState<(typeof reviewStatuses)[number]>('all')
  const [form, setForm] = useState<FormState>({
    source_platform: 'posh',
    booking_signals: 'hosted_similar_event, bar_or_restaurant',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const counts = useMemo(() => buildCounts(leads), [leads])
  const filteredLeads = useMemo(() => (
    statusFilter === 'all'
      ? leads
      : leads.filter((lead) => lead.review_status === statusFilter)
  ), [leads, statusFilter])
  const approvedPct = Math.min(100, Math.round((counts.approved / TARGET_APPROVED) * 100))

  function updateField(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function refresh(nextStatus = statusFilter) {
    setRefreshing(true)
    setMessage('')
    try {
      const query = new URLSearchParams({ limit: '300' })
      if (nextStatus !== 'all') query.set('status', nextStatus)
      const response = await fetch(`/api/admin/supply-scout?${query.toString()}`, { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || 'Unable to refresh Supply Scout leads')
        return
      }
      setLeads((data.leads ?? []) as SupplyScoutLead[])
    } finally {
      setRefreshing(false)
    }
  }

  async function submitLead() {
    setIsSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/admin/supply-scout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(form)),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || 'Unable to capture Supply Scout lead')
        return
      }

      setLeads((current) => [data.lead as SupplyScoutLead, ...current])
      setForm({
        source_platform: form.source_platform || 'posh',
        booking_signals: 'hosted_similar_event, bar_or_restaurant',
      })
      setMessage(data.duplicate ? 'Captured as duplicate. Existing venue/address already matched.' : 'Captured. Lead is queued for review.')
    } finally {
      setIsSaving(false)
    }
  }

  async function reviewLead(lead: SupplyScoutLead, reviewStatus: SupplyScoutLead['review_status']) {
    setReviewingId(lead.id)
    setMessage('')
    try {
      const response = await fetch('/api/admin/supply-scout', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lead.id,
          review_status: reviewStatus,
          booking_likelihood: lead.booking_likelihood,
          confidence: Number(lead.confidence),
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setMessage(data.error || 'Unable to update Supply Scout lead')
        return
      }

      const updatedLead = data.lead as SupplyScoutLead
      setLeads((current) => current.map((item) => (item.id === lead.id ? updatedLead : item)))
      setMessage(reviewStatus === 'approved'
        ? `${updatedLead.name} is now in discovery venues.`
        : `${updatedLead.name} marked ${formatLabel(reviewStatus)}.`
      )
    } finally {
      setReviewingId(null)
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-md border border-border bg-cream p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal supply</p>
              <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Supply Scout</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Capture venue address signals, approve production-ready places, and build the first 150 discovery venues.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <Stat label="Approved" value={`${counts.approved}/${TARGET_APPROVED}`} detail={`${approvedPct}% of target`} tone="primary" />
          <Stat label="Needs review" value={String(counts.needs_review)} detail="Queued leads" />
          <Stat label="Duplicates" value={String(counts.duplicate)} detail="Address matches" />
          <Stat label="Rejected" value={String(counts.rejected)} detail="Filtered out" />
        </section>

        <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <div className="rounded-md border border-border bg-cream p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Capture place</h2>
            </div>
            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="source-platform">Source</Label>
                  <select
                    id="source-platform"
                    value={form.source_platform ?? 'posh'}
                    onChange={(event) => updateField('source_platform', event.target.value)}
                    className="h-11 w-full rounded-2xl border border-border bg-background/70 px-3 text-sm"
                  >
                    {sourcePlatforms.map((platform) => (
                      <option key={platform} value={platform}>{formatLabel(platform)}</option>
                    ))}
                  </select>
                </div>
                <Field label="Event type" value={form.event_type} onChange={(value) => updateField('event_type', value)} placeholder="founder mixer" />
              </div>

              <Field label="Venue name" value={form.name} onChange={(value) => updateField('name', value)} />
              <Field label="Address" value={form.address} onChange={(value) => updateField('address', value)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Neighborhood" value={form.neighborhood} onChange={(value) => updateField('neighborhood', value)} />
                <Field label="Capacity hint" value={form.capacity_hint} onChange={(value) => updateField('capacity_hint', value)} inputMode="numeric" />
              </div>
              <Field label="Source URL" value={form.source_url} onChange={(value) => updateField('source_url', value)} />
              <Field label="Venue website" value={form.website} onChange={(value) => updateField('website', value)} />
              <Field label="Event title" value={form.event_title} onChange={(value) => updateField('event_title', value)} />
              <Field
                label="Booking signals"
                value={form.booking_signals}
                onChange={(value) => updateField('booking_signals', value)}
                placeholder="hosted_similar_event, private_events_page"
              />
              <Field
                label="Disqualifiers"
                value={form.disqualifiers}
                onChange={(value) => updateField('disqualifiers', value)}
                placeholder="private_home, no_public_address"
              />
              <div className="space-y-2">
                <Label htmlFor="evidence-summary">Evidence summary</Label>
                <Textarea
                  id="evidence-summary"
                  value={form.evidence_summary ?? ''}
                  onChange={(event) => updateField('evidence_summary', event.target.value)}
                  className="min-h-[120px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="operator-notes">Operator notes</Label>
                <Textarea
                  id="operator-notes"
                  value={form.operator_notes ?? ''}
                  onChange={(event) => updateField('operator_notes', event.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              {message ? (
                <p className={cn('rounded-2xl border px-3 py-2 text-sm', message.includes('Unable') ? 'border-destructive/40 text-destructive' : 'border-primary/30 text-primary')}>
                  {message}
                </p>
              ) : null}
              <Button type="button" variant="default" onClick={() => void submitLead()} disabled={isSaving}>
                <Plus className="h-4 w-4" />
                {isSaving ? 'Capturing...' : 'Capture lead'}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border bg-cream p-5 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-bold">Lead review</h2>
                <p className="mt-1 text-sm text-muted-foreground">{filteredLeads.length} visible leads</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setStatusFilter(status)
                      void refresh(status)
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-smooth',
                      statusFilter === status
                        ? 'border-primary/50 bg-primary/15 text-primary'
                        : 'border-border bg-background/50 text-muted-foreground hover:border-primary/30'
                    )}
                  >
                    {formatLabel(status)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="pb-3 pr-4">Place</th>
                    <th className="pb-3 pr-4">Source</th>
                    <th className="pb-3 pr-4">Likelihood</th>
                    <th className="pb-3 pr-4">Confidence</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="align-top">
                      <td className="max-w-[320px] py-4 pr-4">
                        <div className="font-medium">{lead.name}</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">{lead.address}</div>
                        {lead.event_title ? (
                          <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lead.event_title}</div>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4">
                        <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs">
                          {formatLabel(lead.source_platform)}
                        </span>
                        {lead.source_url ? (
                          <a
                            href={lead.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4">
                        <LikelihoodBadge value={lead.booking_likelihood} />
                        <div className="mt-2 max-w-[260px] text-xs leading-5 text-muted-foreground">
                          {lead.evidence_summary}
                        </div>
                      </td>
                      <td className="py-4 pr-4">{Math.round(Number(lead.confidence) * 100)}%</td>
                      <td className="py-4 pr-4">
                        <StatusBadge value={lead.review_status} />
                      </td>
                      <td className="py-4 pr-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={reviewingId === lead.id || lead.review_status === 'approved' || lead.booking_likelihood === 'not_suitable'}
                            onClick={() => void reviewLead(lead, 'approved')}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={reviewingId === lead.id || lead.review_status === 'rejected'}
                            onClick={() => void reviewLead(lead, 'rejected')}
                          >
                            <XCircle className="h-4 w-4" />
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLeads.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No leads in this status.</div>
              ) : null}
            </div>
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
  inputMode,
  placeholder,
}: {
  label: string
  value?: string
  onChange: (value: string) => void
  inputMode?: 'numeric'
  placeholder?: string
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className="rounded-2xl bg-background/70"
      />
    </div>
  )
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone?: 'primary'
}) {
  return (
    <div className="rounded-md border border-border bg-cream p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn('mt-2 font-display text-3xl font-bold', tone === 'primary' && 'text-primary')}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function LikelihoodBadge({ value }: { value: SupplyScoutLead['booking_likelihood'] }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium',
        value === 'public_bookable' && 'border-lime-300/40 bg-lime-300/10 text-lime-200',
        value === 'commercial_likely_bookable' && 'border-primary/40 bg-primary/10 text-primary',
        value === 'event_proven_unverified' && 'border-secondary/40 bg-secondary/10 text-secondary',
        value === 'not_suitable' && 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      {formatLabel(value)}
    </span>
  )
}

function StatusBadge({ value }: { value: SupplyScoutLead['review_status'] }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium',
        value === 'approved' && 'border-primary/40 bg-primary/10 text-primary',
        value === 'needs_review' && 'border-border bg-background/60 text-muted-foreground',
        value === 'duplicate' && 'border-yellow-300/40 bg-yellow-300/10 text-yellow-200',
        value === 'rejected' && 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
    >
      {formatLabel(value)}
    </span>
  )
}

function buildPayload(form: FormState) {
  return {
    name: form.name,
    address: form.address,
    neighborhood: emptyToNull(form.neighborhood),
    city: 'San Francisco',
    state: 'CA',
    source_platform: form.source_platform || 'manual',
    source_url: emptyToNull(form.source_url),
    event_title: emptyToNull(form.event_title),
    event_type: emptyToNull(form.event_type),
    evidence_summary: form.evidence_summary,
    booking_signals: splitList(form.booking_signals),
    disqualifiers: splitList(form.disqualifiers),
    website: emptyToNull(form.website),
    capacity_hint: parseNullableInt(form.capacity_hint),
    operator_notes: emptyToNull(form.operator_notes),
  }
}

function buildCounts(leads: SupplyScoutLead[]): SupplyScoutCounts {
  return leads.reduce(
    (counts, lead) => {
      counts.total += 1
      if (lead.review_status === 'needs_review') counts.needs_review += 1
      if (lead.review_status === 'approved') counts.approved += 1
      if (lead.review_status === 'rejected') counts.rejected += 1
      if (lead.review_status === 'duplicate') counts.duplicate += 1
      return counts
    },
    { total: 0, needs_review: 0, approved: 0, rejected: 0, duplicate: 0 }
  )
}

function splitList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function emptyToNull(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function parseNullableInt(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
