'use client'

import type { FormEvent } from 'react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Link2, Mail, MapPin, Package, Search, SlidersHorizontal, UserPlus } from 'lucide-react'
import { inviteVendor } from '@/app/actions/vendorInvites'
import { BookedPartnersWorkspace } from '@/components/planner/BookedPartnersWorkspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CatalogVendor {
  id: string
  name?: string | null
  business_name?: string | null
  service_type?: string | null
  description?: string | null
  bio?: string | null
  availability_notes?: string | null
  city?: string | null
  pricing_model?: string | null
  hourly_rate?: number | null
  base_rate?: number | null
  per_person_rate?: number | null
  requires_deposit?: boolean | null
  deposit_amount?: number | null
  deposit_percentage?: number | null
  lead_time_days?: number | null
  emergency_available?: boolean | null
  emergency_rate_uplift?: number | null
  service_area?: string | null
  regions_served?: string | null
  claim_status?: string | null
  is_claimed?: boolean | null
  is_admin_seeded?: boolean | null
  tier?: 'your_people' | 'warm_intro' | 'catalog' | null
  suggested_rate?: number | null
  suggested_rate_unit?: 'dollars' | 'cents' | null
  suggested_rate_type?: string | null
  trust_tier?: string | null
  last_booked_event_name?: string | null
}

interface VendorRatePrefillPayload {
  amount: number | null
  rate_type: 'flat' | 'per_person' | 'hourly' | null
  source: 'confirmed_agreement' | 'public_base_rate' | 'none'
  provenance_label: string | null
}

interface VendorsApiResponse {
  vendors?: CatalogVendor[]
  vendor_tiers?: {
    your_people?: CatalogVendor[]
    warm_intro?: CatalogVendor[]
    catalog?: CatalogVendor[]
  }
  error?: string
}

async function fetchPlannerVendorCatalog(): Promise<CatalogVendor[]> {
  const response = await fetch(`/api/vendors?planner_catalog=1&tiers=1&ts=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
  const payload = (await response.json()) as VendorsApiResponse

  if (!response.ok) {
    throw new Error(payload.error || 'Catalog temporarily unavailable')
  }

  return (payload.vendors || []).sort((first, second) => Number(second.is_admin_seeded === true) - Number(first.is_admin_seeded === true))
}

/**
 * Planner catalog page for browsing planner-visible vendors.
 *
 * Fetches the public vendor catalog and exposes lightweight search without
 * relying on saved vendors.
 */
export default function PlannerVendorsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedService, setSelectedService] = useState('All')
  const activePlanId = useActivePlannerPlanId()
  const {
    data: vendors = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['planner-vendor-catalog'],
    queryFn: fetchPlannerVendorCatalog,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  const filteredVendors = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    return vendors.filter((vendor) => {
      const vendorName = getVendorName(vendor).toLowerCase()
      const serviceType = formatServiceType(vendor.service_type).toLowerCase()
      const summary = getVendorSummary(vendor).toLowerCase()
      const matchesSearch =
        !normalizedQuery ||
        vendorName.includes(normalizedQuery) ||
        serviceType.includes(normalizedQuery) ||
        summary.includes(normalizedQuery)
      const matchesService = selectedService === 'All' || serviceType === selectedService.toLowerCase()
      return matchesSearch && matchesService
    })
  }, [vendors, searchQuery, selectedService])

  const serviceOptions = useMemo(() => {
    const options = Array.from(new Set(vendors.map((vendor) => formatServiceType(vendor.service_type)).filter(Boolean)))
    return ['All', ...options.slice(0, 7)]
  }, [vendors])

  const catalogStats = useMemo(() => {
    const serviceCount = new Set(vendors.map((vendor) => formatServiceType(vendor.service_type))).size
    const unclaimed = vendors.filter((vendor) => vendor.is_claimed === false).length
    const depositReady = vendors.filter((vendor) => vendor.requires_deposit || vendor.deposit_amount).length

    return [
      { label: 'Catalog vendors', value: vendors.length.toLocaleString() },
      { label: 'Service types', value: serviceCount.toLocaleString() },
      { label: 'Deposit-ready', value: depositReady.toLocaleString() },
      { label: 'Team fallback', value: unclaimed.toLocaleString() },
    ]
  }, [vendors])

  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Vendors</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Bay Area vendors available to book for your events.
        </p>
      </div>

      <div className="space-y-6 px-6 py-6">
        <BookedPartnersWorkspace
          title="Booked Vendors"
          description="Coordinate with vendors after deposits are approved. Message each partner, track deliverables, and keep day-of milestones visible."
          emptyMessage="Vendor bookings will appear here after a deposit or outreach approval is authorized."
          partnerKind="vendor"
          planId={activePlanId}
        />

        <InviteKnownVendorPanel activePlanId={activePlanId} onCatalogChanged={() => void refetch()} />

        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Vendor Catalog</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">Book the missing pieces</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                Compare service type, pricing signals, and readiness before the agent requests availability or deposit terms.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">Plan with agent</Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalogStats.map((stat) => (
              <div key={stat.label} className="rounded-md border border-tan bg-cream-deep/60 p-4">
                <p className="text-xs font-semibold text-ink-soft">{stat.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-lg border border-tan bg-cream p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search vendors by name, service, or package..."
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-ink-soft" />
              {serviceOptions.map((service) => (
                <button
                  key={service}
                  type="button"
                  onClick={() => setSelectedService(service)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-smooth',
                    selectedService === service
                      ? 'border-clay/40 bg-clay text-cream'
                      : 'border-tan bg-cream-deep text-ink-soft hover:text-ink'
                  )}
                >
                  {service}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? <VendorSkeletonGrid /> : null}

        {!isLoading && isError ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            <p className="font-semibold text-ink">Catalog temporarily unavailable</p>
            <p className="mt-1">Vendor listings could not be loaded right now.</p>
            <Button className="mt-4" variant="glass" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </Button>
          </div>
        ) : null}

        {!isLoading && !isError && vendors.length === 0 ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            No vendors in the catalog yet.
          </div>
        ) : null}

        {!isLoading && !isError && vendors.length > 0 && filteredVendors.length === 0 ? (
          <div className="rounded-lg border border-tan bg-cream px-5 py-8 text-sm text-ink-soft">
            No vendors match that search.
          </div>
        ) : null}

        {!isLoading && !isError && filteredVendors.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredVendors.map((vendor) => (
              <VendorCard key={vendor.id} vendor={vendor} activePlanId={activePlanId} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function useActivePlannerPlanId() {
  const [planId, setPlanId] = useState<string | null>(null)

  useEffect(() => {
    function readPlanIdFromStorage() {
      try {
        const raw = window.localStorage.getItem('planner-live-plan')
        if (!raw) return null
        const parsed = JSON.parse(raw) as { planId?: unknown }
        return typeof parsed.planId === 'string' && parsed.planId.trim() ? parsed.planId : null
      } catch {
        return null
      }
    }

    function refreshPlanId(event?: Event) {
      const detail = event && 'detail' in event ? (event as CustomEvent<{ planId?: unknown }>).detail : null
      const nextPlanId = typeof detail?.planId === 'string' && detail.planId.trim()
        ? detail.planId
        : readPlanIdFromStorage()
      setPlanId(nextPlanId)
    }

    refreshPlanId()
    window.addEventListener('planner-live-plan:update', refreshPlanId)
    return () => window.removeEventListener('planner-live-plan:update', refreshPlanId)
  }, [])

  return planId
}

interface InviteKnownVendorPanelProps {
  activePlanId: string | null
  onCatalogChanged: () => void
}

function InviteKnownVendorPanel({ activePlanId, onCatalogChanged }: InviteKnownVendorPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{
    ok: boolean
    message: string
    claimUrl?: string
    existing?: boolean
    emailSent?: boolean
  } | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const response = await inviteVendor({
        vendorName: String(formData.get('vendorName') || ''),
        email: String(formData.get('email') || ''),
        phone: String(formData.get('phone') || ''),
        serviceType: String(formData.get('serviceType') || 'other') as any,
        rateType: String(formData.get('rateType') || 'flat') as any,
        proposedRateAmount: Number(formData.get('proposedRateAmount') || 0),
        planId: activePlanId,
      })

      if (!response.ok) {
        setResult({ ok: false, message: response.error || 'Could not send this invite.' })
        return
      }

      if (activePlanId && response.vendorId) {
        await attachVendorToActivePlan({
          planId: activePlanId,
          vendorId: response.vendorId,
          amount: Number(formData.get('proposedRateAmount') || 0),
          rateType: String(formData.get('rateType') || 'flat') as 'flat' | 'per_person' | 'hourly',
          commitAgreement: false,
        })
      }

      onCatalogChanged()
      setResult({
        ok: true,
        existing: response.existing,
        emailSent: response.emailSent,
        claimUrl: response.claimUrl,
        message: response.existing
          ? 'This vendor was already in your people. I reused the existing invite record.'
          : 'Invite created. They can claim the private listing, confirm the private rate, and add a public catalog rate later if they want to be discoverable.',
      })
    })
  }

  return (
    <section className="rounded-lg border border-clay/20 bg-cream p-5 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-clay-tint text-clay">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Your people</p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink">Bring a vendor you already trust</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Invite them with the private rate you agreed on. They claim the profile and confirm or counter that rate; public catalog pricing is optional and can come later.
            </p>
          </div>
        </div>
        <Button variant={isOpen ? 'glass' : 'hero'} size="sm" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? 'Close invite' : 'Invite someone I work with'}
        </Button>
      </div>

      {isOpen ? (
        <form onSubmit={handleSubmit} className="mt-5 grid gap-4 rounded-lg border border-tan bg-cream-deep/60 p-4 lg:grid-cols-6">
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Vendor name</span>
            <Input name="vendorName" required placeholder="DJ Maya" />
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Email</span>
            <Input name="email" required type="email" placeholder="maya@example.com" />
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Phone optional</span>
            <Input name="phone" type="tel" placeholder="(415) 555-0100" />
          </label>

          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Service</span>
            <select
              name="serviceType"
              className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
              defaultValue="dj"
            >
              <option value="dj">DJ / music</option>
              <option value="catering">Catering</option>
              <option value="bartending">Bartending</option>
              <option value="photography">Photography</option>
              <option value="videography">Videography</option>
              <option value="av_tech">AV tech</option>
              <option value="event_planning">Event staff</option>
              <option value="florist">Florals / decor</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Private agreed rate</span>
            <Input name="proposedRateAmount" required min="1" step="1" type="number" placeholder="450" />
          </label>
          <label className="space-y-1 lg:col-span-2">
            <span className="text-xs font-semibold text-ink-soft">Rate type</span>
            <select
              name="rateType"
              className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
              defaultValue="flat"
            >
              <option value="flat">Flat</option>
              <option value="per_person">Per person</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>

          <div className="flex flex-col gap-3 lg:col-span-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-xs text-ink-soft">
              Private rates are scoped to you and this vendor. Public catalog rates are set by the vendor after claim.
            </p>
            <Button type="submit" variant="hero" size="sm" disabled={isPending}>
              {isPending ? 'Sending invite...' : 'Send invite'}
            </Button>
          </div>
        </form>
      ) : null}

      {result ? (
        <div
          className={cn(
            'mt-4 rounded-md border px-4 py-3 text-sm',
            result.ok
              ? 'border-accent/30 bg-accent/10 text-ink'
              : 'border-brick/30 bg-brick-tint text-ink'
          )}
        >
          <p className="font-semibold">{result.message}</p>
          {result.ok && result.claimUrl ? (
            <div className="mt-2 flex flex-col gap-2 text-xs text-ink-soft sm:flex-row sm:items-center">
              {result.emailSent ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" />
                  Email sent
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Link2 className="h-3.5 w-3.5" />
                  Email provider is not configured; use this local claim link:
                </span>
              )}
              {!result.emailSent ? (
                <a className="break-all font-semibold text-clay underline" href={result.claimUrl}>
                  {result.claimUrl}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Loading skeleton for the vendor catalog.
 */
function VendorSkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-tan bg-cream p-5">
          <div className="h-5 w-2/3 rounded bg-cream-deep" />
          <div className="mt-4 h-4 w-1/2 rounded bg-cream-deep" />
          <div className="mt-6 h-10 rounded bg-cream-deep" />
        </div>
      ))}
    </div>
  )
}

interface VendorCardProps {
  vendor: CatalogVendor
  activePlanId: string | null
}

/**
 * Compact public vendor catalog card for planner users.
 */
function VendorCard({ vendor, activePlanId }: VendorCardProps) {
  const vendorName = getVendorName(vendor)
  const serviceType = formatServiceType(vendor.service_type)
  const summary = truncateText(getVendorSummary(vendor), 124)
  const startingRate = formatVendorRate(vendor)
  const depositLabel = formatVendorDeposit(vendor)
  const city = vendor.city || formatServiceArea(vendor.regions_served || vendor.service_area)
  const emergencyLabel = vendor.emergency_available
    ? `Emergency +${Math.round(vendor.emergency_rate_uplift ?? 0)}%`
    : 'Standard lead'

  return (
    <article className={cn('flex min-h-full flex-col rounded-lg border border-tan bg-cream p-5 shadow-card')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-ink">{vendorName}</h2>
            {vendor.claim_status === 'invited_unclaimed' ? (
              <span className="mt-2 inline-flex rounded-full bg-clay-tint px-2 py-0.5 text-xs font-medium text-clay">
                Invited — pending signup
              </span>
            ) : null}
            <p className="mt-1 text-sm font-semibold text-ink-soft">{serviceType}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {vendor.tier ? (
            <span className="rounded-full border border-clay/30 bg-clay-tint px-2 py-1 text-xs font-semibold text-clay">
              {formatTierLabel(vendor.tier)}
            </span>
          ) : null}
          {vendor.is_claimed === false ? (
            <span className="rounded-full border border-tan bg-cream-deep px-2 py-1 text-xs font-semibold text-ink-soft">
              Unclaimed
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-4 min-h-12 text-sm leading-relaxed text-ink-soft">{summary}</p>
      {vendor.tier === 'your_people' && vendor.last_booked_event_name ? (
        <p className="mt-2 text-xs font-semibold text-clay">
          Uses your last confirmed rate from {vendor.last_booked_event_name}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Location</p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate font-semibold text-ink" title={city}>
            <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
            {city}
          </p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Starting rate</p>
          <p className="mt-1 truncate font-semibold text-ink" title={startingRate}>{startingRate}</p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Deposit</p>
          <p className="mt-1 truncate font-semibold text-ink" title={depositLabel}>{depositLabel}</p>
        </div>
        <div className="rounded-lg border border-tan bg-cream-deep/55 p-3">
          <p className="text-xs text-ink-soft">Lead time</p>
          <p className="mt-1 truncate font-semibold text-ink">
            {typeof vendor.lead_time_days === 'number' && vendor.lead_time_days > 0
              ? `${vendor.lead_time_days} days`
              : 'Confirm'}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {vendor.emergency_available ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            <CheckCircle2 className="h-3 w-3" />
            {emergencyLabel}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 rounded-full border border-tan bg-cream-deep px-2.5 py-1 text-xs font-semibold text-ink-soft">
          <CheckCircle2 className="h-3 w-3 text-clay" />
          Availability request
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-tan bg-cream-deep px-2.5 py-1 text-xs font-semibold text-ink-soft">
          <CheckCircle2 className="h-3 w-3 text-clay" />
          Deposit approval
        </span>
      </div>

      <Button variant="outline" size="sm" className="mt-5 w-full" asChild>
        <Link href={`/planner/vendors/${vendor.id}`}>View profile</Link>
      </Button>

      {activePlanId ? (
        <PlanVendorRateAttach
          key={`${activePlanId}-${vendor.id}`}
          planId={activePlanId}
          vendor={vendor}
        />
      ) : null}
    </article>
  )
}

interface PlanVendorRateAttachProps {
  planId: string
  vendor: CatalogVendor
}

function PlanVendorRateAttach({ planId, vendor }: PlanVendorRateAttachProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState('')
  const [rateType, setRateType] = useState<'flat' | 'per_person' | 'hourly'>('flat')
  const [provenanceLabel, setProvenanceLabel] = useState<string | null>(null)
  const [hasEdited, setHasEdited] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function openRateEditor() {
    setIsOpen((current) => !current)
    if (isOpen || amount) return

    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/plans/${planId}/vendors/${vendor.id}/rate`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as {
        prefill?: VendorRatePrefillPayload
        error?: string
      }
      if (!response.ok) throw new Error(payload.error || 'Could not load rate history.')
      const prefill = payload.prefill
      setAmount(typeof prefill?.amount === 'number' ? String(prefill.amount) : '')
      setRateType(prefill?.rate_type ?? normalizeRateType(vendor.pricing_model) ?? 'flat')
      setProvenanceLabel(prefill?.provenance_label ?? null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load rate history.')
    } finally {
      setIsLoading(false)
    }
  }

  async function saveRate() {
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('Enter a rate before adding this vendor.')
      return
    }

    setIsSaving(true)
    setErrorMessage(null)
    setWarning(null)
    setStatusMessage(null)
    try {
      const result = await attachVendorToActivePlan({
        planId,
        vendorId: vendor.id,
        amount: parsedAmount,
        rateType,
        commitAgreement: true,
      })
      setWarning(result.rate_commit?.warning ?? null)
      setStatusMessage('Added to the active plan.')
      setProvenanceLabel(hasEdited ? null : provenanceLabel)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not add this vendor to the plan.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-tan bg-cream-deep/55 p-3">
      <Button type="button" variant="glass" size="sm" className="w-full" onClick={openRateEditor}>
        {isOpen ? 'Hide plan rate' : 'Add to active plan'}
      </Button>

      {isOpen ? (
        <div className="mt-3 space-y-3">
          {isLoading ? (
            <p className="text-xs text-ink-soft">Loading your rate history...</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-ink-soft">Rate</span>
                  <Input
                    value={amount}
                    min="1"
                    step="1"
                    type="number"
                    onChange={(event) => {
                      setAmount(event.target.value)
                      setHasEdited(true)
                    }}
                    placeholder="450"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-ink-soft">Type</span>
                  <select
                    value={rateType}
                    onChange={(event) => {
                      setRateType(event.target.value as 'flat' | 'per_person' | 'hourly')
                      setHasEdited(true)
                    }}
                    className="h-10 w-full rounded-md border border-tan bg-cream-deep px-3 text-sm text-ink"
                  >
                    <option value="flat">Flat</option>
                    <option value="per_person">Per person</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </label>
              </div>

              {provenanceLabel && !hasEdited ? (
                <p className="text-xs font-semibold text-clay">{provenanceLabel}</p>
              ) : hasEdited ? (
                <p className="text-xs font-semibold text-ink-soft">edited</p>
              ) : null}

              {warning ? (
                <p className="rounded-md border border-clay/30 bg-clay-tint px-3 py-2 text-xs text-clay">
                  {warning}
                </p>
              ) : null}
              {statusMessage ? (
                <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
                  {statusMessage}
                </p>
              ) : null}
              {errorMessage ? (
                <p className="rounded-md border border-brick/30 bg-brick-tint px-3 py-2 text-xs text-brick">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="button" variant="hero" size="sm" className="w-full" onClick={saveRate} disabled={isSaving}>
                {isSaving ? 'Adding vendor...' : 'Save to active plan'}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

async function attachVendorToActivePlan(input: {
  planId: string
  vendorId: string
  amount: number
  rateType: 'flat' | 'per_person' | 'hourly'
  commitAgreement: boolean
}): Promise<{ plan?: unknown; rate_commit?: { warning?: string | null } | null }> {
  const response = await fetch(`/api/planner/plans/${input.planId}/vendors/${input.vendorId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: input.amount,
      rate_type: input.rateType,
      commit_agreement: input.commitAgreement,
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    plan?: unknown
    rate_commit?: { warning?: string | null } | null
    error?: string
  }
  if (!response.ok) throw new Error(payload.error || 'Could not attach vendor to plan.')

  updatePlannerLivePlanPayload(payload.plan)
  return payload
}

function updatePlannerLivePlanPayload(plan: unknown) {
  if (typeof window === 'undefined' || !plan || typeof plan !== 'object') return

  try {
    const raw = window.localStorage.getItem('planner-live-plan')
    const current = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    const next = {
      ...current,
      plan: {
        ...(typeof current.plan === 'object' && current.plan !== null ? current.plan as Record<string, unknown> : {}),
        ...(plan as Record<string, unknown>),
      },
    }
    window.localStorage.setItem('planner-live-plan', JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: next }))
  } catch {
    window.dispatchEvent(new CustomEvent('planner-live-plan:update'))
  }
}

/**
 * Returns the best available vendor display name.
 */
function getVendorName(vendor: CatalogVendor) {
  return vendor.business_name || vendor.name || 'Untitled vendor'
}

/**
 * Formats service_type values for display.
 */
function formatServiceType(serviceType: string | null | undefined) {
  if (!serviceType) return 'Vendor'

  return serviceType
    .split('_')
    .map((part) => (part.toLowerCase() === 'av' ? 'AV' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * Returns the best available vendor summary text.
 */
function getVendorSummary(vendor: CatalogVendor) {
  return vendor.bio || vendor.description || vendor.availability_notes || 'Package details available on request.'
}

/**
 * Formats the best available vendor rate signal.
 */
function formatVendorRate(vendor: CatalogVendor) {
  const amount = vendor.suggested_rate ?? vendor.base_rate ?? vendor.hourly_rate ?? vendor.per_person_rate ?? null
  if (typeof amount !== 'number') return vendor.pricing_model ? formatServiceType(vendor.pricing_model) : 'Quote needed'

  const dollars = vendor.suggested_rate_unit === 'cents'
    ? amount / 100
    : vendor.suggested_rate_unit === 'dollars'
      ? amount
      : amount > 1000
        ? amount / 100
        : amount
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars)

  if (vendor.suggested_rate_type === 'per_person' || vendor.per_person_rate === amount) return `${formatted}/person`
  if (vendor.suggested_rate_type === 'hourly' || vendor.hourly_rate === amount) return `${formatted}/hr`
  return `From ${formatted}`
}

function formatTierLabel(tier: NonNullable<CatalogVendor['tier']>) {
  if (tier === 'your_people') return 'Your people'
  if (tier === 'warm_intro') return 'Warm intro'
  return 'Catalog'
}

function normalizeRateType(value: unknown): 'flat' | 'per_person' | 'hourly' | null {
  if (value === 'flat_rate') return 'flat'
  if (value === 'flat' || value === 'per_person' || value === 'hourly') return value
  return null
}

/**
 * Formats vendor deposit readiness without inventing a payment.
 */
function formatVendorDeposit(vendor: CatalogVendor) {
  if (typeof vendor.deposit_amount === 'number' && vendor.deposit_amount > 0) {
    const amount = vendor.deposit_amount > 1000 ? vendor.deposit_amount / 100 : vendor.deposit_amount
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount)
  }

  if (typeof vendor.deposit_percentage === 'number' && vendor.deposit_percentage > 0) {
    return `${Math.round(vendor.deposit_percentage)}%`
  }

  if (vendor.requires_deposit) return 'Required'
  return 'On request'
}

function formatServiceArea(value: string | null | undefined) {
  if (!value) return 'Bay Area'
  return value
    .split(/[_\s,]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'sf') return 'SF'
      if (lower === 'bay') return 'Bay'
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * Truncates long vendor descriptions for compact cards.
 */
function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
