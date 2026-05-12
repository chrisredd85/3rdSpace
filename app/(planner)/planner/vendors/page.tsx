'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, MapPin, Package, Search, SlidersHorizontal } from 'lucide-react'
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
  is_claimed?: boolean | null
  is_admin_seeded?: boolean | null
}

interface VendorsApiResponse {
  vendors?: CatalogVendor[]
  error?: string
}

async function fetchPlannerVendorCatalog(): Promise<CatalogVendor[]> {
  const response = await fetch(`/api/vendors?planner_catalog=1&ts=${Date.now()}`, {
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
      { label: 'Concierge fallback', value: unclaimed.toLocaleString() },
    ]
  }, [vendors])

  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Vendors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bay Area vendors available to book for your events.
        </p>
      </div>

      <div className="space-y-6 px-6 py-6">
        <BookedPartnersWorkspace
          title="Booked Vendors"
          description="Coordinate with vendors after deposits are approved. Message each partner, track deliverables, and keep day-of milestones visible."
          emptyMessage="Vendor bookings will appear here after a deposit or outreach approval is authorized."
          partnerKind="vendor"
        />

        <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Vendor Catalog</p>
              <h2 className="mt-2 font-display text-xl font-bold text-foreground">Book the missing pieces</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Compare service type, pricing signals, and readiness before the agent requests availability or deposit terms.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">Plan with agent</Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {catalogStats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-background/50 p-4">
                <p className="text-xs font-semibold text-muted-foreground">{stat.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search vendors by name, service, or package..."
                className="pl-9"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
              {serviceOptions.map((service) => (
                <button
                  key={service}
                  type="button"
                  onClick={() => setSelectedService(service)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-smooth',
                    selectedService === service
                      ? 'border-primary/40 bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
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
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Catalog temporarily unavailable</p>
            <p className="mt-1">Vendor listings could not be loaded right now.</p>
            <Button className="mt-4" variant="glass" size="sm" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying...' : 'Retry'}
            </Button>
          </div>
        ) : null}

        {!isLoading && !isError && vendors.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            No vendors in the catalog yet.
          </div>
        ) : null}

        {!isLoading && !isError && vendors.length > 0 && filteredVendors.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
            No vendors match that search.
          </div>
        ) : null}

        {!isLoading && !isError && filteredVendors.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredVendors.map((vendor) => (
              <VendorCard key={vendor.id} vendor={vendor} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Loading skeleton for the vendor catalog.
 */
function VendorSkeletonGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border border-border bg-card p-5">
          <div className="h-5 w-2/3 rounded bg-muted" />
          <div className="mt-4 h-4 w-1/2 rounded bg-muted" />
          <div className="mt-6 h-10 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

interface VendorCardProps {
  vendor: CatalogVendor
}

/**
 * Compact public vendor catalog card for planner users.
 */
function VendorCard({ vendor }: VendorCardProps) {
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
    <article className={cn('flex min-h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-card')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-primary">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-foreground">{vendorName}</h2>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">{serviceType}</p>
          </div>
        </div>
        {vendor.is_claimed === false ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground">
            Unclaimed
          </span>
        ) : null}
      </div>

      <p className="mt-4 min-h-12 text-sm leading-relaxed text-muted-foreground">{summary}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Location</p>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate font-semibold text-foreground" title={city}>
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {city}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Starting rate</p>
          <p className="mt-1 truncate font-semibold text-foreground" title={startingRate}>{startingRate}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Deposit</p>
          <p className="mt-1 truncate font-semibold text-foreground" title={depositLabel}>{depositLabel}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">Lead time</p>
          <p className="mt-1 truncate font-semibold text-foreground">
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
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-primary" />
          Availability request
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-primary" />
          Deposit approval
        </span>
      </div>

      <Button variant="outline" size="sm" className="mt-5 w-full" asChild>
        <Link href={`/planner/vendors/${vendor.id}`}>View profile</Link>
      </Button>
    </article>
  )
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
  const amount = vendor.base_rate ?? vendor.hourly_rate ?? vendor.per_person_rate ?? null
  if (typeof amount !== 'number') return vendor.pricing_model ? formatServiceType(vendor.pricing_model) : 'Quote needed'

  const dollars = amount > 1000 ? amount / 100 : amount
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars)

  if (vendor.per_person_rate === amount) return `${formatted}/person`
  if (vendor.hourly_rate === amount) return `${formatted}/hr`
  return `From ${formatted}`
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
