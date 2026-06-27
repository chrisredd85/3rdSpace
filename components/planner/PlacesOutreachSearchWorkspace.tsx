'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MailPlus,
  MapPin,
  Phone,
  Search,
  Send,
  SkipForward,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ContactStatus = 'ready_to_reach_out' | 'contact_form_available' | 'contact_pending' | 'no_contact_available'

type DiscoveryCandidate = {
  candidate_id: string
  discovery_venue_id: string
  name: string
  address: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  website: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_email_source: 'direct' | 'organizer_provided' | 'extracted' | null
  contact_email_confidence: 'high' | 'medium' | 'low' | null
  contact_form_url: string | null
  contact_form_label: string | null
  contact_form_source_path: string | null
  contact_status: ContactStatus
  extraction_status: string | null
  fit_score: number
  status: string
  google_rating: number | null
  google_user_ratings_total: number | null
  photo_urls: string[]
  photos: Array<{
    name: string
    authorAttributions?: Array<{
      displayName?: string
      uri?: string
    }>
  }>
}

type DiscoverySummary = {
  total: number
  ready_to_reach_out: number
  contact_form_available?: number
  contact_pending: number
  no_contact_available: number
}

type DiscoverResponse = {
  candidates: DiscoveryCandidate[]
  summary: DiscoverySummary
}

type ApprovalResponse = {
  approvals: Array<{
    approval_id: string
    approval_message_id: string | null
    redirect_url: string | null
    target_count: number
    discovery_venue_ids: string[]
    venue_names: string[]
  }>
  created_count: number
  target_count?: number
}

type PlacesOutreachSearchWorkspaceProps = {
  initialPlanId?: string | null
}

export function PlacesOutreachSearchWorkspace({ initialPlanId }: PlacesOutreachSearchWorkspaceProps) {
  const [planId, setPlanId] = useState(initialPlanId ?? '')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([])
  const [summary, setSummary] = useState<DiscoverySummary | null>(null)
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([])
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({})
  const [isSearching, setIsSearching] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [busyVenueId, setBusyVenueId] = useState<string | null>(null)
  const [isApproving, setIsApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approvalResult, setApprovalResult] = useState<ApprovalResponse | null>(null)

  const readyCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.contact_status === 'ready_to_reach_out'),
    [candidates]
  )
  const rescueCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.contact_status !== 'ready_to_reach_out'),
    [candidates]
  )
  const selectedReadyCount = selectedVenueIds.filter((id) => readyCandidates.some((candidate) => candidate.discovery_venue_id === id)).length
  const approvalTargetCount = approvalResult?.target_count ?? approvalResult?.approvals.reduce((sum, approval) => sum + approval.target_count, 0) ?? 0

  async function loadCandidates(nextPlanId = planId) {
    const trimmedPlanId = nextPlanId.trim()
    if (!trimmedPlanId) {
      setError('Select an active plan before loading venue candidates.')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(trimmedPlanId)}/discover-venues`, {
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({})) as Partial<DiscoverResponse> & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load venues')
      applyCandidates(payload.candidates ?? [], payload.summary ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load venues')
    } finally {
      setIsLoading(false)
    }
  }

  async function searchVenues() {
    const trimmedPlanId = planId.trim()
    if (!trimmedPlanId) {
      setError('Select an active plan before searching Places.')
      return
    }

    setIsSearching(true)
    setError(null)
    setApprovalResult(null)
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(trimmedPlanId)}/discover-venues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim() || undefined,
          maxResultCount: 8,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Partial<DiscoverResponse> & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to search Places')
      applyCandidates(payload.candidates ?? [], payload.summary ?? null)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Unable to search Places')
    } finally {
      setIsSearching(false)
    }
  }

  async function saveContactEmail(candidate: DiscoveryCandidate) {
    const email = emailDrafts[candidate.discovery_venue_id]?.trim()
    if (!email) {
      setError(`Add an email for ${candidate.name} before saving.`)
      return
    }

    setBusyVenueId(candidate.discovery_venue_id)
    setError(null)
    try {
      const response = await fetch(`/api/planner/discovery-venues/${encodeURIComponent(candidate.discovery_venue_id)}/contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save contact email')
      setEmailDrafts((current) => ({ ...current, [candidate.discovery_venue_id]: '' }))
      await loadCandidates()
      setSelectedVenueIds((current) => {
        if (current.includes(candidate.discovery_venue_id) || current.length >= 6) return current
        return [...current, candidate.discovery_venue_id]
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save contact email')
    } finally {
      setBusyVenueId(null)
    }
  }

  async function skipCandidate(candidate: DiscoveryCandidate) {
    const trimmedPlanId = planId.trim()
    if (!trimmedPlanId) return

    setBusyVenueId(candidate.discovery_venue_id)
    setError(null)
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(trimmedPlanId)}/discover-venues`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discovery_venue_id: candidate.discovery_venue_id, action: 'dismiss' }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to skip venue')
      await loadCandidates()
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : 'Unable to skip venue')
    } finally {
      setBusyVenueId(null)
    }
  }

  async function createApprovals() {
    const trimmedPlanId = planId.trim()
    const readyIds = selectedVenueIds.filter((id) => readyCandidates.some((candidate) => candidate.discovery_venue_id === id))
    if (!trimmedPlanId || readyIds.length === 0) {
      setError('Select at least one ready venue before creating approvals.')
      return
    }

    setIsApproving(true)
    setError(null)
    setApprovalResult(null)
    try {
      const response = await fetch(`/api/planner/plans/${encodeURIComponent(trimmedPlanId)}/outreach/approve-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discovery_venue_ids: readyIds }),
      })
      const payload = await response.json().catch(() => ({})) as Partial<ApprovalResponse> & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to create outreach approvals')
      setApprovalResult({
        approvals: payload.approvals ?? [],
        created_count: payload.created_count ?? 0,
      })
      await loadCandidates()
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : 'Unable to create outreach approvals')
    } finally {
      setIsApproving(false)
    }
  }

  function applyCandidates(nextCandidates: DiscoveryCandidate[], nextSummary: DiscoverySummary | null) {
    setCandidates(nextCandidates)
    setSummary(nextSummary)
    const readyIds = nextCandidates
      .filter((candidate) => candidate.contact_status === 'ready_to_reach_out')
      .map((candidate) => candidate.discovery_venue_id)
    setSelectedVenueIds((current) => {
      const currentReady = current.filter((id) => readyIds.includes(id))
      return currentReady.length > 0 ? currentReady : readyIds.slice(0, 6)
    })
  }

  function toggleSelected(candidate: DiscoveryCandidate) {
    setSelectedVenueIds((current) => {
      if (current.includes(candidate.discovery_venue_id)) {
        return current.filter((id) => id !== candidate.discovery_venue_id)
      }
      if (current.length >= 6) return current
      return [...current, candidate.discovery_venue_id]
    })
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Places to outreach</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">Find venues for this plan</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Search Places, save missing contacts, then create approval cards before any Gmail outreach sends.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/planner/outreach">
                Gmail workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={planId.trim() ? `/planner?plan=${encodeURIComponent(planId.trim())}&tab=approvals` : '/planner?tab=approvals'}>
                Planner approvals
              </Link>
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive" role="alert">
            {error}
          </div>
        ) : null}

        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-xl">Search source</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 pt-6 lg:grid-cols-[minmax(220px,0.7fr)_minmax(320px,1fr)_auto] lg:items-end">
            <Field label="Plan ID">
              <Input
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                placeholder="Active planner plan ID"
              />
            </Field>
            <Field label="Search phrase">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="happy hour bars in Mission"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={searchVenues} disabled={isSearching || isLoading}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search Places
              </Button>
              <Button type="button" variant="outline" onClick={() => loadCandidates()} disabled={isSearching || isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {summary ? (
          <div className="grid gap-3 sm:grid-cols-5">
            <Metric label="Venues found" value={summary.total} />
            <Metric label="Ready" value={summary.ready_to_reach_out} />
            <Metric label="Forms found" value={summary.contact_form_available ?? 0} />
            <Metric label="Checking" value={summary.contact_pending} />
            <Metric label="No contact" value={summary.no_contact_available} />
          </div>
        ) : null}

        {approvalResult ? (
          <Card className="border-forest/30 bg-forest/10 shadow-sm">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-foreground">
                  {approvalResult.created_count} bulk outreach approval{approvalResult.created_count === 1 ? '' : 's'} created
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Open the planner approvals queue to review {approvalTargetCount} selected venue message{approvalTargetCount === 1 ? '' : 's'} before send.
                </p>
              </div>
              <Button asChild>
                <Link href={planId.trim() ? `/planner?plan=${encodeURIComponent(planId.trim())}&tab=approvals` : '/planner?tab=approvals'}>
                  Review approvals
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <CheckCircle2 className="h-5 w-5 text-forest" />
                    Ready to reach out
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {readyCandidates.length} venue{readyCandidates.length === 1 ? '' : 's'} have a resolved contact.
                  </p>
                </div>
                <Button type="button" onClick={createApprovals} disabled={selectedReadyCount === 0 || isApproving}>
                  {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Create bulk approval{selectedReadyCount ? ` for ${selectedReadyCount}` : ''}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {readyCandidates.length > 0 ? (
                readyCandidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.discovery_venue_id}
                    candidate={candidate}
                    isSelected={selectedVenueIds.includes(candidate.discovery_venue_id)}
                    onToggleSelected={() => toggleSelected(candidate)}
                    onSkip={() => skipCandidate(candidate)}
                    isBusy={busyVenueId === candidate.discovery_venue_id}
                    mode="ready"
                  />
                ))
              ) : (
                <EmptyState text="No ready venues yet. Search Places or add contact emails below." />
              )}
            </CardContent>
          </Card>

          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle className="flex items-center gap-2 text-xl">
                <MailPlus className="h-5 w-5 text-primary" />
                Add contact email
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {rescueCandidates.length} venue{rescueCandidates.length === 1 ? '' : 's'} need an email before Gmail approval. Contact forms are linked when found.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {rescueCandidates.length > 0 ? (
                rescueCandidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.discovery_venue_id}
                    candidate={candidate}
                    isSelected={false}
                    onToggleSelected={() => undefined}
                    onSkip={() => skipCandidate(candidate)}
                    isBusy={busyVenueId === candidate.discovery_venue_id}
                    mode="rescue"
                    emailValue={emailDrafts[candidate.discovery_venue_id] ?? ''}
                    onEmailChange={(value) => setEmailDrafts((current) => ({ ...current, [candidate.discovery_venue_id]: value }))}
                    onSaveEmail={() => saveContactEmail(candidate)}
                  />
                ))
              ) : (
                <EmptyState text="No venues need contact rescue." />
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  isSelected,
  onToggleSelected,
  onSkip,
  isBusy,
  mode,
  emailValue,
  onEmailChange,
  onSaveEmail,
}: {
  candidate: DiscoveryCandidate
  isSelected: boolean
  onToggleSelected: () => void
  onSkip: () => void
  isBusy: boolean
  mode: 'ready' | 'rescue'
  emailValue?: string
  onEmailChange?: (value: string) => void
  onSaveEmail?: () => void
}) {
  const firstPhoto = candidate.photo_urls[0]
  const attribution = candidate.photos[0]?.authorAttributions?.[0]

  return (
    <article className="overflow-hidden rounded-md border border-border bg-background/70">
      {firstPhoto ? (
        <div className="relative h-40 w-full overflow-hidden bg-cream-deep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={firstPhoto} alt="" className="h-full w-full object-cover" loading="lazy" />
          {attribution?.displayName ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-ink/70 px-2 py-1 text-[10px] font-semibold text-cream">
              {attribution.displayName}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold leading-tight text-foreground">{candidate.name}</h2>
            <p className="mt-1 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{candidate.address ?? ([candidate.neighborhood, candidate.city].filter(Boolean).join(', ') || 'Bay Area')}</span>
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs font-bold text-muted-foreground">
            {candidate.fit_score}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground">
          {candidate.google_rating ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
              <Star className="h-3.5 w-3.5 fill-primary text-primary" />
              {candidate.google_rating.toFixed(1)}
              {candidate.google_user_ratings_total ? ` (${candidate.google_user_ratings_total})` : ''}
            </span>
          ) : null}
          {candidate.contact_phone ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1">
              <Phone className="h-3.5 w-3.5" />
              {candidate.contact_phone}
            </span>
          ) : null}
          {candidate.contact_email ? (
            <span className="rounded-full border border-forest/30 bg-forest/10 px-2.5 py-1 text-forest">
              {candidate.contact_email_source?.replace(/_/g, ' ') ?? 'contact'} email
            </span>
          ) : candidate.contact_status === 'contact_form_available' ? (
            <span className="rounded-full border border-ochre/35 bg-ochre/10 px-2.5 py-1 text-ochre">
              Contact form found
            </span>
          ) : (
            <span className="rounded-full border border-border bg-card px-2.5 py-1">
              {candidate.contact_status.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {candidate.website ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={candidate.website} target="_blank" rel="noreferrer">
                Open website
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          {candidate.contact_form_url ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={candidate.contact_form_url} target="_blank" rel="noreferrer">
                {candidate.contact_form_label ?? 'Open contact form'}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onSkip} disabled={isBusy}>
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
            Skip
          </Button>
          {mode === 'ready' ? (
            <Button type="button" variant={isSelected ? 'default' : 'outline'} size="sm" onClick={onToggleSelected}>
              {isSelected ? 'Selected' : 'Select'}
            </Button>
          ) : null}
        </div>

        {mode === 'rescue' ? (
          <div className="grid gap-3">
            {candidate.contact_form_url ? (
              <p className="rounded-md border border-ochre/25 bg-ochre/10 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
                The crawler found a contact form, but Gmail outreach still needs an email. Open the form or site, then paste the best contact email here when available.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={emailValue ?? ''}
                onChange={(event) => onEmailChange?.(event.target.value)}
                placeholder="booking@example.com"
                inputMode="email"
                aria-label={`Contact email for ${candidate.name}`}
              />
              <Button type="button" onClick={onSaveEmail} disabled={isBusy || !emailValue?.trim()}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label className="mb-1.5 block text-sm font-semibold text-foreground">{label}</Label>
      {children}
    </label>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-background/60 p-6 text-sm leading-relaxed text-muted-foreground">
      {text}
    </div>
  )
}
