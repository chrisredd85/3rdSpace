import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowLeft, Building2, Clock3, Mail, MapPin, Search, SlidersHorizontal, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { loadVenueDiscoveryCandidates } from '@/lib/planner/venueDiscoveryData'
import {
  rankVenueDiscoveryCandidates,
  type RankedVenueDiscoveryCandidate,
  type VenueDiscoveryCandidate,
} from '@/lib/planner/venueDiscoveryRanker'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: {
    q?: string
    neighborhood?: string
    capacity?: string
    vibe?: string
    budget?: string
    source?: string
  }
}

export default async function PlannerVenueDiscoverPage({ searchParams }: PageProps) {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-muted-foreground">
        Sign in to discover venues.
      </div>
    )
  }

  const candidates = await loadVenueDiscoveryCandidates({ db, limit: 120 })
  const candidateMap = new Map(candidates.map((candidate) => [`${candidate.source}:${candidate.id}`, candidate]))
  const ranked = rankVenueDiscoveryCandidates({
    plan: {
      headcount: parsePositiveInt(searchParams.capacity),
      neighborhood: normalizeQuery(searchParams.neighborhood),
      budget_cap_cents: parseBudgetCents(searchParams.budget),
      vibe_tags: normalizeQuery(searchParams.vibe) ? [String(searchParams.vibe)] : [],
    },
    candidates,
    limit: 80,
  })
  const filtered = ranked.filter((candidate) => matchesFilters(candidate, candidateMap, searchParams))
  const stats = buildStats(candidates)

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button asChild variant="outline" size="sm" className="mb-4">
              <Link href="/planner/venues">
                <ArrowLeft className="h-4 w-4" />
                Venues
              </Link>
            </Button>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Discovery dataset</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">Venue Discover</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Search onboarded and discovery venues before asking the planner agent to prepare approval-gated outreach.
            </p>
          </div>
          <Button asChild variant="default">
            <Link href="/planner">
              <Mail className="h-4 w-4" />
              Plan outreach
            </Link>
          </Button>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border border-border bg-cream p-4 shadow-sm">
              <p className="text-xs font-semibold text-muted-foreground">{stat.label}</p>
              <p className="mt-2 font-display text-2xl font-bold text-foreground">{stat.value}</p>
            </div>
          ))}
        </section>

        <Card className="rounded-md">
          <CardContent className="pt-6">
            <form className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,0.8fr))_auto] lg:items-end">
              <Field label="Search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input name="q" defaultValue={searchParams.q ?? ''} placeholder="Name, city, tag" className="pl-9" />
                </div>
              </Field>
              <Field label="Neighborhood">
                <Input name="neighborhood" defaultValue={searchParams.neighborhood ?? ''} placeholder="Mission" />
              </Field>
              <Field label="Guests">
                <Input name="capacity" defaultValue={searchParams.capacity ?? ''} inputMode="numeric" placeholder="80" />
              </Field>
              <Field label="Vibe">
                <Input name="vibe" defaultValue={searchParams.vibe ?? ''} placeholder="rooftop" />
              </Field>
              <Field label="Budget">
                <Input name="budget" defaultValue={searchParams.budget ?? ''} inputMode="numeric" placeholder="5000" />
              </Field>
              <Field label="Source">
                <select
                  name="source"
                  defaultValue={searchParams.source ?? 'all'}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-smooth focus:border-primary"
                >
                  <option value="all">All</option>
                  <option value="onboarded">Onboarded</option>
                  <option value="discovery">Discovery</option>
                </select>
              </Field>
              <Button type="submit" variant="outline">
                <SlidersHorizontal className="h-4 w-4" />
                Filter
              </Button>
            </form>
          </CardContent>
        </Card>

        {filtered.length === 0 ? (
          <Card className="rounded-md">
            <CardContent className="py-10 text-center">
              <p className="font-display text-xl font-bold text-foreground">No venues match these filters</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Broaden the neighborhood, capacity, or source filters.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((candidate) => (
              <DiscoveryVenueCard
                key={`${candidate.source}:${candidate.candidate_id}`}
                candidate={candidate}
                sourceRow={candidateMap.get(`${candidate.source}:${candidate.candidate_id}`) ?? null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function DiscoveryVenueCard({
  candidate,
  sourceRow,
}: {
  candidate: RankedVenueDiscoveryCandidate
  sourceRow: VenueDiscoveryCandidate | null
}) {
  const tags = (sourceRow?.vibe_tags ?? []).slice(0, 4)
  const price = formatPrice(sourceRow)
  const responseLabel = formatResponseLabel(candidate)

  return (
    <article className="flex min-h-full flex-col rounded-md border border-border bg-cream p-5 shadow-sm transition-smooth hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-foreground">{candidate.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {candidate.neighborhood ?? candidate.city ?? 'Bay Area'}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold',
            candidate.source === 'onboarded'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-primary/40 bg-primary/10 text-primary'
          )}
        >
          {candidate.source === 'onboarded' ? 'Onboarded' : 'Reaching out'}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric icon={<Users className="h-3.5 w-3.5" />} label="Capacity" value={candidate.capacity ? candidate.capacity.toLocaleString() : 'Verify'} />
        <Metric icon={<Clock3 className="h-3.5 w-3.5" />} label="Response" value={responseLabel} />
        <Metric label="Price hint" value={price} />
        <Metric label="Match" value={`${Math.round(candidate.score * 100)}%`} />
      </div>

      <div className="mt-4 min-h-[88px] space-y-2">
        {candidate.reasoning.slice(0, 3).map((reason) => (
          <p key={reason} className="text-sm leading-5 text-muted-foreground">{reason}</p>
        ))}
      </div>

      {tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              {formatTag(tag)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link href={`/planner?venue=${candidate.target_id}&source=${candidate.target_source}`}>
            Ask agent to use this venue
          </Link>
        </Button>
      </div>
    </article>
  )
}

function Metric({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/45 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate font-semibold text-foreground">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        {value}
      </p>
    </div>
  )
}

function matchesFilters(
  candidate: RankedVenueDiscoveryCandidate,
  candidateMap: Map<string, VenueDiscoveryCandidate>,
  filters: PageProps['searchParams']
) {
  const source = filters.source ?? 'all'
  if (source !== 'all' && candidate.source !== source) return false

  const sourceRow = candidateMap.get(`${candidate.source}:${candidate.candidate_id}`) ?? null
  const query = normalizeQuery(filters.q)
  if (query) {
    const haystack = [
      candidate.name,
      candidate.neighborhood,
      candidate.city,
      ...(sourceRow?.vibe_tags ?? []),
    ].join(' ').toLowerCase()
    if (!haystack.includes(query)) return false
  }

  const requestedNeighborhood = normalizeQuery(filters.neighborhood)
  if (requestedNeighborhood) {
    const location = `${candidate.neighborhood ?? ''} ${candidate.city ?? ''}`.toLowerCase()
    if (!location.includes(requestedNeighborhood)) return false
  }

  const requestedCapacity = parsePositiveInt(filters.capacity)
  if (requestedCapacity && candidate.capacity && candidate.capacity < requestedCapacity) return false

  const vibe = normalizeQuery(filters.vibe)
  if (vibe && !(sourceRow?.vibe_tags ?? []).some((tag) => tag.toLowerCase().includes(vibe))) return false

  const budget = parseBudgetCents(filters.budget)
  const high = sourceRow?.price_hint_cents_high ?? sourceRow?.estimate_cents ?? null
  if (budget && high && high > budget) return false

  return true
}

function buildStats(candidates: VenueDiscoveryCandidate[]) {
  const onboarded = candidates.filter((candidate) => candidate.source === 'onboarded').length
  const discovery = candidates.filter((candidate) => candidate.source === 'discovery').length
  const emailReady = candidates.filter((candidate) => Boolean(candidate.contact_email)).length
  const withSignals = candidates.filter((candidate) => (candidate.signals?.emailsSent30d ?? 0) > 0).length

  return [
    { label: 'Total candidates', value: candidates.length.toLocaleString() },
    { label: 'Onboarded', value: onboarded.toLocaleString() },
    { label: 'Discovery', value: discovery.toLocaleString() },
    { label: 'With signals', value: withSignals.toLocaleString() || emailReady.toLocaleString() },
  ]
}

function formatPrice(candidate: VenueDiscoveryCandidate | null) {
  const low = candidate?.price_hint_cents_low ?? candidate?.estimate_cents ?? null
  const high = candidate?.price_hint_cents_high ?? candidate?.estimate_cents ?? null
  if (!low && !high) return 'Quote'
  if (low && high && low !== high) return `${formatCents(low)}-${formatCents(high)}`
  return formatCents(low ?? high ?? 0)
}

function formatResponseLabel(candidate: RankedVenueDiscoveryCandidate) {
  if (candidate.response_rate_30d === null) return 'No signal'
  return `${Math.round(candidate.response_rate_30d * 100)}% replied`
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100))
}

function formatTag(value: string) {
  return value
    .split(/[_-]+/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeQuery(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}

function parsePositiveInt(value: string | undefined) {
  if (!value) return null
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseBudgetCents(value: string | undefined) {
  const dollars = parsePositiveInt(value)
  return dollars ? dollars * 100 : null
}
