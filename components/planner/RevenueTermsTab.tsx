'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RevenueTermType =
  | 'sales_tax'
  | 'ticketing_fee'
  | 'service_fee'
  | 'venue_kickback'
  | 'venue_minimum_spend'
  | 'vendor_rev_share'
  | 'sponsor_credit'
  | 'other'

type RevenueTermAppliesTo =
  | 'gross_ticket_revenue'
  | 'net_ticket_revenue'
  | 'bar_revenue'
  | 'per_ticket'
  | 'per_attendee'

type RevenueTermConfidence = 'low' | 'medium' | 'high'
type RevenueTermSource = 'manual' | 'platform_default' | 'outreach_reply'

type RevenueTermRow = {
  id: string
  event_id: string
  org_id: string
  term_type: RevenueTermType
  rate: number | string | null
  flat_cents: number | string | null
  applies_to: RevenueTermAppliesTo
  party_id: string | null
  party_name: string | null
  notes: string | null
  confidence: RevenueTermConfidence
  source: RevenueTermSource
  created_at: string
  updated_at: string
}

type RevenueTermImpact = {
  term_id: string | null
  term_type: RevenueTermType
  party_id: string | null
  party_name: string | null
  applies_to: RevenueTermAppliesTo
  basis_cents: number
  unit_count: number | null
  amount_cents: number
  net_revenue_delta_cents: number
  cost_delta_cents: number
}

type RevenueTermsResponse = {
  terms?: RevenueTermRow[]
  impacts?: RevenueTermImpact[]
  summary?: {
    sales_tax_cents: number
    platform_fee_cents: number
    venue_kickback_cents: number
    sponsor_credit_cents: number
    vendor_rev_share_cents: number
    venue_minimum_spend_cents: number
    other_cents: number
  }
  actuals?: {
    gross_revenue_cents: number
    net_revenue_cents: number
    tickets_sold: number
    tickets_checked_in: number | null
  }
  error?: string
}

type DraftState = {
  id: string | null
  term_type: RevenueTermType
  applies_to: RevenueTermAppliesTo
  rate_percent: string
  flat_dollars: string
  party_name: string
  notes: string
  confidence: RevenueTermConfidence
}

const emptyDraft: DraftState = {
  id: null,
  term_type: 'service_fee',
  applies_to: 'gross_ticket_revenue',
  rate_percent: '',
  flat_dollars: '',
  party_name: '',
  notes: '',
  confidence: 'medium',
}

const termLabels: Record<RevenueTermType, string> = {
  sales_tax: 'Sales tax',
  ticketing_fee: 'Ticketing fee',
  service_fee: 'Service fee',
  venue_kickback: 'Venue kickback',
  venue_minimum_spend: 'Venue minimum spend',
  vendor_rev_share: 'Vendor rev share',
  sponsor_credit: 'Sponsor credit',
  other: 'Other',
}

const appliesToLabels: Record<RevenueTermAppliesTo, string> = {
  gross_ticket_revenue: 'Gross ticket revenue',
  net_ticket_revenue: 'Net ticket revenue',
  bar_revenue: 'Bar revenue',
  per_ticket: 'Per ticket',
  per_attendee: 'Per attendee',
}

const sourceLabels: Record<RevenueTermSource, string> = {
  manual: 'Manual',
  platform_default: 'Platform default',
  outreach_reply: 'Outreach reply',
}

interface RevenueTermsTabProps {
  eventId: string
}

export function RevenueTermsTab({ eventId }: RevenueTermsTabProps) {
  const [terms, setTerms] = useState<RevenueTermRow[]>([])
  const [impacts, setImpacts] = useState<RevenueTermImpact[]>([])
  const [summary, setSummary] = useState<RevenueTermsResponse['summary'] | null>(null)
  const [actuals, setActuals] = useState<RevenueTermsResponse['actuals'] | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadTerms = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/${eventId}/revenue-terms`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as RevenueTermsResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load revenue terms')
      setTerms(payload.terms ?? [])
      setImpacts(payload.impacts ?? [])
      setSummary(payload.summary ?? null)
      setActuals(payload.actuals ?? null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load revenue terms')
    } finally {
      setIsLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    void loadTerms()
  }, [loadTerms])

  const impactByTermId = useMemo(() => {
    return new Map(impacts.map((impact) => [impact.term_id, impact]))
  }, [impacts])

  const totals = useMemo(() => ({
    deductions:
      (summary?.sales_tax_cents ?? 0) +
      (summary?.platform_fee_cents ?? 0) +
      (summary?.vendor_rev_share_cents ?? 0) +
      (summary?.venue_minimum_spend_cents ?? 0),
    additions:
      (summary?.venue_kickback_cents ?? 0) +
      (summary?.sponsor_credit_cents ?? 0),
    gross: actuals?.gross_revenue_cents ?? 0,
    net: actuals?.net_revenue_cents ?? 0,
  }), [actuals, summary])

  async function handleSave() {
    if (!draft) return

    const rate = parsePercent(draft.rate_percent)
    const flatCents = parseDollarsToCents(draft.flat_dollars)
    if (rate === null && flatCents === null) {
      setErrorMessage('Enter a rate or a flat amount.')
      return
    }

    setIsSaving(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/${eventId}/revenue-terms`, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: draft.id ?? undefined,
          term_type: draft.term_type,
          applies_to: draft.applies_to,
          rate,
          flat_cents: flatCents,
          party_name: draft.party_name.trim() || null,
          notes: draft.notes.trim() || null,
          confidence: draft.confidence,
          source: 'manual',
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save revenue term')
      setDraft(null)
      await loadTerms()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save revenue term')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(termId: string) {
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/${eventId}/revenue-terms`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: termId }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to delete revenue term')
      await loadTerms()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to delete revenue term')
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <TotalTile label="Gross sold" value={totals.gross} />
        <TotalTile label="Deductions" value={totals.deductions} tone="deduction" />
        <TotalTile label="Credits" value={totals.additions} tone="credit" />
        <TotalTile label="Net revenue" value={totals.net} tone="net" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">Revenue terms</h2>
          <p className="text-sm text-muted-foreground">
            {terms.length} terms · {actuals?.tickets_sold ?? 0} tickets sold
          </p>
        </div>
        <Button type="button" onClick={() => setDraft(emptyDraft)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add term
        </Button>
      </div>

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {errorMessage}
        </div>
      ) : null}

      {draft ? (
        <TermForm
          draft={draft}
          isSaving={isSaving}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={handleSave}
        />
      ) : null}

      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-card/50 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading revenue terms
        </div>
      ) : terms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-5 py-10 text-center">
          <p className="font-medium text-foreground">No revenue terms recorded yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Add taxes, platform fees, kickbacks, credits, or rev-share terms.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {terms.map((term, index) => (
            <TermRow
              key={term.id}
              term={term}
              impact={impactByTermId.get(term.id) ?? null}
              isLast={index === terms.length - 1}
              onEdit={() => setDraft(draftFromTerm(term))}
              onDelete={() => void handleDelete(term.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TotalTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'deduction' | 'credit' | 'net'
}) {
  return (
    <div className={cn(
      'rounded-md border bg-card px-4 py-4',
      tone === 'deduction' ? 'border-primary/30' : 'border-border',
      tone === 'credit' ? 'border-emerald-700/30' : '',
      tone === 'net' ? 'border-foreground/20' : ''
    )}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{formatCents(value)}</p>
    </div>
  )
}

function TermRow({
  term,
  impact,
  isLast,
  onEdit,
  onDelete,
}: {
  term: RevenueTermRow
  impact: RevenueTermImpact | null
  isLast: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className={cn('grid gap-3 px-4 py-4 lg:grid-cols-[1.35fr_1fr_0.8fr_auto]', !isLast && 'border-b border-border')}>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{term.party_name ? `${term.party_name} ${termLabels[term.term_type].toLowerCase()}` : termLabels[term.term_type]}</p>
        <p className="mt-1 text-sm text-muted-foreground">{describeFormula(term)}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Impact</p>
        <p className="mt-1 font-medium text-foreground">{impact ? describeImpact(impact) : formatCents(0)}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Confidence</p>
        <p className="mt-1 capitalize text-foreground">{term.confidence} · {sourceLabels[term.source]}</p>
      </div>
      <div className="flex items-center justify-start gap-2 lg:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onEdit} aria-label="Edit revenue term">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDelete} aria-label="Delete revenue term">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function TermForm({
  draft,
  isSaving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: DraftState
  isSaving: boolean
  onChange: (draft: DraftState) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Term">
          <select
            value={draft.term_type}
            onChange={(event) => onChange({ ...draft, term_type: event.target.value as RevenueTermType })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {Object.entries(termLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Applies to">
          <select
            value={draft.applies_to}
            onChange={(event) => onChange({ ...draft, applies_to: event.target.value as RevenueTermAppliesTo })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            {Object.entries(appliesToLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Rate">
          <input
            value={draft.rate_percent}
            onChange={(event) => onChange({ ...draft, rate_percent: event.target.value })}
            inputMode="decimal"
            placeholder="5"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </Field>
        <Field label="Flat">
          <input
            value={draft.flat_dollars}
            onChange={(event) => onChange({ ...draft, flat_dollars: event.target.value })}
            inputMode="decimal"
            placeholder="250"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </Field>
        <Field label="Party">
          <input
            value={draft.party_name}
            onChange={(event) => onChange({ ...draft, party_name: event.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </Field>
        <Field label="Confidence">
          <select
            value={draft.confidence}
            onChange={(event) => onChange({ ...draft, confidence: event.target.value as RevenueTermConfidence })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
        <Field label="Notes" wide>
          <input
            value={draft.notes}
            onChange={(event) => onChange({ ...draft, notes: event.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          <X className="mr-2 h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
        <Button type="button" onClick={onSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={cn('block space-y-1.5', wide && 'lg:col-span-2')}>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function draftFromTerm(term: RevenueTermRow): DraftState {
  return {
    id: term.id,
    term_type: term.term_type,
    applies_to: term.applies_to,
    rate_percent: term.rate === null ? '' : String(readNumber(term.rate) * 100),
    flat_dollars: term.flat_cents === null ? '' : String(readNumber(term.flat_cents) / 100),
    party_name: term.party_name ?? '',
    notes: term.notes ?? '',
    confidence: term.confidence,
  }
}

function describeFormula(term: RevenueTermRow) {
  const pieces: string[] = []
  const rate = term.rate === null ? null : readNumber(term.rate)
  const flatCents = term.flat_cents === null ? null : Math.round(readNumber(term.flat_cents))

  if (rate !== null && rate > 0) pieces.push(`${formatPercent(rate)} of ${appliesToLabels[term.applies_to].toLowerCase()}`)
  if (flatCents !== null && flatCents > 0) {
    pieces.push(`${formatCents(flatCents)}${term.applies_to === 'per_ticket' ? ' per ticket' : term.applies_to === 'per_attendee' ? ' per attendee' : ''}`)
  }

  return pieces.join(' + ') || appliesToLabels[term.applies_to]
}

function describeImpact(impact: RevenueTermImpact) {
  if (impact.unit_count !== null) {
    return `${formatCents(impact.amount_cents)} of ${impact.unit_count} ${impact.applies_to === 'per_attendee' ? 'attendees' : 'tickets'}`
  }
  return `${formatCents(impact.amount_cents)} of ${formatCents(impact.basis_cents)}`
}

function parsePercent(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed / 100 : null
}

function parseDollarsToCents(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null
}

function readNumber(value: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatPercent(value: number) {
  const percent = value > 1 ? value : value * 100
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(percent)}%`
}

export function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
