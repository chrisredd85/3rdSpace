'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  Coffee,
  DollarSign,
  Gift,
  LayoutTemplate,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
  Users2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SavedTemplate = {
  id: string
  name: string
  description: string | null
  snapshot: unknown
  created_at: string
}

type RebookDraft = {
  date_window_start: string
  date_window_end: string
  guest_count: string
  budget_dollars: string
  neighborhood: string
  use_same_venue: boolean
  use_same_vendors: boolean
}

const STARTER_TEMPLATES = [
  {
    id: 'founder-dinner',
    title: 'Founder dinner',
    icon: Coffee,
    meta: '20 to 40 guests · private dining · guests pay venue',
    prompt: 'I want to host a founder dinner for 28 operators. Guests will pay the venue directly. Help me find the right private dining room.',
  },
  {
    id: 'networking-mixer',
    title: 'Networking mixer',
    icon: Users2,
    meta: '60 to 150 guests · bar minimum · photographer optional',
    prompt: 'I want to host a networking mixer for 90 startup people. It should be RSVP only with a bar minimum and light bites.',
  },
  {
    id: 'brand-launch',
    title: 'Brand launch',
    icon: Sparkles,
    meta: '75 to 250 guests · sponsor friendly · AV and photo moments',
    prompt: 'I want to host a brand launch for 150 guests with demo stations, AV, photos, and sponsor visibility.',
  },
  {
    id: 'holiday-reception',
    title: 'Holiday reception',
    icon: Gift,
    meta: '50 to 300 guests · package pricing · seasonal vendors',
    prompt: 'I want to host a holiday reception for 120 guests with catering, bar, decor, and a photo booth.',
  },
]

export default function PlannerTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<SavedTemplate[]>([])
  const [drafts, setDrafts] = useState<Record<string, RebookDraft>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null)

  useEffect(() => {
    void loadTemplates()
  }, [])

  const hasTemplates = templates.length > 0

  async function loadTemplates() {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/planner/templates', {
        method: 'GET',
        cache: 'no-store',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to load saved templates')
      }

      const nextTemplates = Array.isArray(payload?.templates) ? payload.templates as SavedTemplate[] : []
      setTemplates(nextTemplates)
      setDrafts((current) => {
        const nextDrafts: Record<string, RebookDraft> = {}
        for (const template of nextTemplates) {
          nextDrafts[template.id] = current[template.id] ?? buildDefaultRebookDraft(template)
        }
        return nextDrafts
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load saved templates')
    } finally {
      setIsLoading(false)
    }
  }

  function updateDraft(templateId: string, patch: Partial<RebookDraft>) {
    setError(null)
    setDrafts((current) => ({
      ...current,
      [templateId]: {
        ...(current[templateId] ?? buildDefaultRebookDraft(templates.find((template) => template.id === templateId))),
        ...patch,
      },
    }))
  }

  async function applyTemplate(event: FormEvent<HTMLFormElement>, template: SavedTemplate) {
    event.preventDefault()
    const draft = drafts[template.id] ?? buildDefaultRebookDraft(template)
    const guestCount = parseIntegerInput(draft.guest_count)
    const budgetCapCents = parseBudgetCents(draft.budget_dollars)

    if (!draft.date_window_start) {
      setError('Choose a new event date before applying the template.')
      return
    }

    if (guestCount === null) {
      setError('Add a new guest count before applying the template.')
      return
    }

    if (!draft.neighborhood.trim()) {
      setError('Add a neighborhood or city so matching can rerun for the new plan.')
      return
    }

    setApplyingTemplateId(template.id)
    setError(null)

    try {
      const response = await fetch(`/api/planner/templates/${template.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          create_new_plan: true,
          date_window_start: draft.date_window_start,
          date_window_end: draft.date_window_end || draft.date_window_start,
          guest_count: guestCount,
          budget_cap_cents: budgetCapCents,
          neighborhood: draft.neighborhood.trim() || null,
          use_same_venue: draft.use_same_venue,
          use_same_vendors: draft.use_same_vendors,
          rerun_recommendations: true,
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Unable to apply template')
      }

      const planId = typeof payload?.plan?.id === 'string' ? payload.plan.id : null
      if (!planId) {
        throw new Error('Template applied, but the new plan was not returned.')
      }

      router.push(`/planner?plan=${encodeURIComponent(planId)}`)
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Unable to apply template')
      setApplyingTemplateId(null)
    }
  }

  function startFromStarter(prompt: string) {
    router.push(`/planner?draft=${encodeURIComponent(prompt)}`)
  }

  return (
    <div className="min-h-screen bg-cream-deep px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-lg border border-tan bg-cream p-6 shadow-card md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-clay">Planner templates</p>
            <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Rebook proven event plans</h1>
            <p className="mt-3 text-sm leading-6 text-ink-soft sm:text-base">
              Save a completed plan, apply it to a new date and headcount, then re-run venue, vendor, and economics matching before any approval or outreach can happen.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="glass" onClick={() => void loadTemplates()} disabled={isLoading}>
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button type="button" variant="hero" onClick={() => router.push('/planner')}>
              <LayoutTemplate className="h-4 w-4" />
              Save current plan
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-brick/40 bg-brick-tint px-5 py-4 text-sm text-brick shadow-card">
            {error}
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold">Saved event templates</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Apply one to a fresh plan. Old recommendations are treated as assumptions and matching is recalculated.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="rounded-lg border border-tan bg-cream px-5 py-12 text-center text-sm text-ink-soft shadow-card">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-clay" />
              Loading saved templates...
            </div>
          ) : null}

          {!isLoading && !hasTemplates ? (
            <div className="rounded-lg border border-dashed border-tan bg-cream px-5 py-12 text-center shadow-card">
              <LayoutTemplate className="mx-auto h-8 w-8 text-clay" />
              <h3 className="mt-4 font-display text-lg font-bold">No saved templates yet</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
                Finish a plan in the chat, save it as a template, then come back here to create the next run with fresh timing, size, budget, and matching.
              </p>
              <Button type="button" variant="hero" className="mt-5" onClick={() => router.push('/planner')}>
                Open planner
              </Button>
            </div>
          ) : null}

          {!isLoading && hasTemplates ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {templates.map((template) => (
                <SavedTemplateCard
                  key={template.id}
                  template={template}
                  draft={drafts[template.id] ?? buildDefaultRebookDraft(template)}
                  isApplying={applyingTemplateId === template.id}
                  isDisabled={applyingTemplateId !== null}
                  onChange={(patch) => updateDraft(template.id, patch)}
                  onSubmit={(event) => void applyTemplate(event, template)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="font-display text-xl font-bold">Starter templates</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Use these when you do not have a completed event plan saved yet.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STARTER_TEMPLATES.map((template) => {
              const Icon = template.icon
              return (
                <article key={template.id} className="rounded-lg border border-tan bg-cream p-5 shadow-card">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-brand shadow-glow">
                    <Icon className="h-6 w-6 text-cream" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold">{template.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft">{template.meta}</p>
                  <Button type="button" variant="glass" className="mt-5 w-full" onClick={() => startFromStarter(template.prompt)}>
                    Start from this
                  </Button>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

function SavedTemplateCard(props: {
  template: SavedTemplate
  draft: RebookDraft
  isApplying: boolean
  isDisabled: boolean
  onChange: (patch: Partial<RebookDraft>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const snapshot = readRecord(props.template.snapshot)
  const eventType = readString(snapshot?.event_type) ?? 'Event plan'
  const guestRange = formatGuestRange(snapshot)
  const budgetLabel = formatCents(readBudgetCapCents(snapshot))
  const createdAt = formatTemplateCreatedAt(props.template.created_at)

  return (
    <article className="rounded-lg border border-tan bg-cream p-5 shadow-card">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-brand shadow-glow">
          <LayoutTemplate className="h-6 w-6 text-cream" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words font-display text-lg font-bold">{props.template.name}</h3>
            <span className="rounded-full border border-clay/30 bg-clay-tint px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-clay">
              Saved
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{props.template.description ?? eventType}</p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-widest text-ink-soft">{createdAt}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <TemplateStat icon={Users} label="Original size" value={guestRange} />
        <TemplateStat icon={DollarSign} label="Budget model" value={budgetLabel ?? 'Estimate'} />
        <TemplateStat icon={Calendar} label="Event type" value={eventType} />
      </div>

      <form className="mt-5 space-y-4" onSubmit={props.onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New date">
            <Input
              type="date"
              value={props.draft.date_window_start}
              onChange={(event) => props.onChange({ date_window_start: event.target.value })}
              disabled={props.isDisabled}
              required
            />
          </Field>
          <Field label="End date">
            <Input
              type="date"
              value={props.draft.date_window_end}
              onChange={(event) => props.onChange({ date_window_end: event.target.value })}
              disabled={props.isDisabled}
            />
          </Field>
          <Field label="Guest count">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={props.draft.guest_count}
              onChange={(event) => props.onChange({ guest_count: event.target.value })}
              disabled={props.isDisabled}
              required
            />
          </Field>
          <Field label="Budget">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="Leave blank to estimate"
              value={props.draft.budget_dollars}
              onChange={(event) => props.onChange({ budget_dollars: event.target.value })}
              disabled={props.isDisabled}
            />
          </Field>
        </div>

        <Field label="Neighborhood or city">
          <Input
            type="text"
            value={props.draft.neighborhood}
            placeholder="SOMA, Mission, Oakland..."
            onChange={(event) => props.onChange({ neighborhood: event.target.value })}
            disabled={props.isDisabled}
            required
          />
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm text-ink-soft transition-smooth', props.draft.use_same_venue ? 'border-clay/40 bg-clay-tint/55' : 'border-tan bg-cream-deep/60')}>
            <input
              type="checkbox"
              checked={props.draft.use_same_venue}
              onChange={(event) => props.onChange({ use_same_venue: event.target.checked })}
              disabled={props.isDisabled}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block font-semibold text-ink">Try same venue</span>
              Boost ranking for the saved venue. Capacity and availability still checked — no preference if ineligible.
            </span>
          </label>
          <label className={cn('flex items-start gap-3 rounded-lg border p-3 text-sm text-ink-soft transition-smooth', props.draft.use_same_vendors ? 'border-clay/40 bg-clay-tint/55' : 'border-tan bg-cream-deep/60')}>
            <input
              type="checkbox"
              checked={props.draft.use_same_vendors}
              onChange={(event) => props.onChange({ use_same_vendors: event.target.checked })}
              disabled={props.isDisabled}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block font-semibold text-ink">Try same vendors</span>
              Boost ranking for saved vendors. No outreach until you approve the fresh plan.
            </span>
          </label>
        </div>

        <Button type="submit" variant="hero" className="w-full" disabled={props.isDisabled}>
          {props.isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Create plan and rerun matches
        </Button>
      </form>
    </article>
  )
}

function TemplateStat(props: {
  icon: LucideIcon
  label: string
  value: string
}) {
  const Icon = props.icon
  return (
    <div className="rounded-lg border border-tan bg-cream-deep/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-ink-soft">
        <Icon className="h-3.5 w-3.5 text-clay" />
        {props.label}
      </div>
      <p className="mt-2 break-words text-sm font-semibold text-ink">{props.value}</p>
    </div>
  )
}

function Field(props: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-2 text-sm font-semibold text-ink">
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

function hasSelectedVenue(snapshot: Record<string, unknown> | null): boolean {
  const shoppingList = readRecord(snapshot?.shopping_list)
  if (!shoppingList) return false
  const selectedVenue = readRecord(shoppingList.selected_venue)
  return Boolean(selectedVenue && (readString(selectedVenue.reference_id) ?? readString(selectedVenue.id)))
}

function hasSelectedVendors(snapshot: Record<string, unknown> | null): boolean {
  const shoppingList = readRecord(snapshot?.shopping_list)
  if (!shoppingList) return false
  const selectedVendors = Array.isArray(shoppingList.selected_vendors) ? shoppingList.selected_vendors : []
  return selectedVendors.some((vendor) => {
    const vendorRecord = readRecord(vendor)
    return Boolean(vendorRecord && (readString(vendorRecord.reference_id) ?? readString(vendorRecord.id)))
  })
}

function buildDefaultRebookDraft(template?: SavedTemplate): RebookDraft {
  const snapshot = readRecord(template?.snapshot)
  const guestCount = midpointGuestCount(snapshot)
  const budgetCapCents = readBudgetCapCents(snapshot)

  return {
    date_window_start: '',
    date_window_end: '',
    guest_count: guestCount !== null ? String(guestCount) : '',
    budget_dollars: budgetCapCents !== null ? String(Math.round(budgetCapCents / 100)) : '',
    neighborhood: readString(snapshot?.target_audience) ?? '',
    use_same_venue: hasSelectedVenue(snapshot),
    use_same_vendors: hasSelectedVendors(snapshot),
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBudgetCapCents(snapshot: Record<string, unknown> | null): number | null {
  return readNumber(readRecord(snapshot?.budget_model)?.budget_cap_cents)
}

function midpointGuestCount(snapshot: Record<string, unknown> | null): number | null {
  const min = readNumber(snapshot?.guest_count_min)
  const max = readNumber(snapshot?.guest_count_max)
  if (min !== null && max !== null) return Math.round((min + max) / 2)
  return min ?? max
}

function formatGuestRange(snapshot: Record<string, unknown> | null): string {
  const min = readNumber(snapshot?.guest_count_min)
  const max = readNumber(snapshot?.guest_count_max)
  if (min !== null && max !== null && min !== max) return `${min}-${max} guests`
  const value = min ?? max
  return value !== null ? `${value} guests` : 'Guest count TBD'
}

function formatCents(cents: number | null): string | null {
  if (cents === null) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function parseIntegerInput(value: string): number | null {
  const parsed = Number.parseInt(value.replace(/[,\s]/g, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseBudgetCents(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number.parseFloat(value.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null
}

function formatTemplateCreatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Saved template'
  return `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
