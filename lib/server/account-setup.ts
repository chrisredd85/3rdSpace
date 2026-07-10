import { SERVICE_TYPE_LABELS, VENUE_AMENITY_LABEL_BY_ID, type TicketPlatform } from '@/lib/constants/account-setup'
import { dollarsToCents, type VenueNightlyRateCents } from '@/lib/money'
import { normalizeBuilderAmenityPreferences, normalizeBuilderEventTypes } from '@/lib/server/builderPreferences'
import type { ServiceType, UserType, VenueType } from '@/lib/types'
import { buildVenueNightlyRateReconciliation } from '@/lib/venues/venueRateUnits'

type SupabaseLikeClient = any

const TICKET_PLATFORM_IDS = ['eventbrite', 'luma', 'posh', 'partiful'] as const
const ticketPlatformSet = new Set<string>(TICKET_PLATFORM_IDS)

export type BuilderSetupInput = {
  userId: string
  name: string
  organizationName: string
  organizationType?: string | null
  socialHandle?: string | null
  website?: string | null
  bio?: string | null
  eventTypes: string[]
  preferredAmenities?: string[]
  ticketPlatforms: TicketPlatform[]
  typicalAttendanceMin?: number | null
  typicalAttendanceMax?: number | null
  bulkBookingEnabled?: boolean | null
  inviteCollaborators?: string[]
  origin?: string
}

export type VenueSetupInput = {
  userId: string
  claimVenueId?: string | null
  contactName: string
  venueName: string
  address: string
  city: string
  neighborhood?: string | null
  state: string
  zipCode: string
  venueType: VenueType
  capacity: number
  houseRules: string
  amenities: string[]
  phone?: string | null
  hasBar?: boolean | null
  barKickbackPct?: number | null
  perHeadDrinkPct?: number | null
  supportedCommercialTerms?: string[] | null
  minBarSpend?: number | null
  pricePerNight?: number | null
  deposit?: number | null
  cancellationTerms?: string | null
  availableDays?: string[] | null
  openFrom?: string | null
  openTo?: string | null
  loadingAddress?: string | null
  prepTimeHours?: number | null
}

export type VendorSetupInput = {
  userId: string
  name: string
  businessName?: string | null
  serviceType: ServiceType
  servicesOffered?: string[]
  bankAccountHolderName?: string | null
  bankName?: string | null
  availabilityNotes: string
  phone?: string | null
  serviceArea?: string | null
  portfolioUrl?: string | null
  bio?: string | null
  basePrice?: number | null
  packageName?: string | null
  packageDetails?: string | null
  depositPct?: number | null
  leadTimeDays?: number | null
  cancellationTerms?: string | null
  availableDays?: string[] | null
  emergencyAvailable?: boolean | null
  emergencyRateUplift?: number | null
}

function getAccountWebhookUrl(origin: string, platform: TicketPlatform, connectionId: string) {
  const url = new URL(`/api/webhooks/${platform}`, origin)
  url.searchParams.set('builderConnectionId', connectionId)
  return url.toString()
}

function isMissingTicketingConnectionsTable(error: { code?: string; message?: string } | null | undefined) {
  return (
    error?.code === 'PGRST205' ||
    (
      /builder_ticketing_connections/i.test(error?.message ?? '') &&
      /schema cache|does not exist|could not find/i.test(error?.message ?? '')
    )
  )
}

function toPositiveNumberOrNull(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value
}

function toIntegerCentsOrNull(value: number | null | undefined) {
  const positiveValue = toPositiveNumberOrNull(value)
  return positiveValue === null ? null : dollarsToCents(positiveValue)
}

export function buildVenueNightlyRateFields(pricePerNight: number | null | undefined): {
  price_per_night_cents: VenueNightlyRateCents | null
} {
  return {
    price_per_night_cents: toIntegerCentsOrNull(pricePerNight) as VenueNightlyRateCents | null,
  }
}

function toPositivePercentageOrNull(value: number | null | undefined) {
  const positiveValue = toPositiveNumberOrNull(value)
  if (positiveValue === null || positiveValue > 100) return null
  return Math.round(positiveValue)
}

const supportedVenueCommercialTerms = new Set([
  'minimum_spend',
  'bar_consumption_chi',
  'ticket_chi',
  'per_attendee_chi',
])

function normalizeVenueCommercialTerms(value: string[] | null | undefined) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((term) => typeof term === 'string' ? term.trim() : '')
      .filter((term) => supportedVenueCommercialTerms.has(term))
  ))
}

function normalizeVendorServiceArea(value: string | null | undefined) {
  const rawValue = value?.trim()
  if (!rawValue) return null

  const normalized = rawValue.toLowerCase()
  if (/\ball\b|\bbay area\b|all_bay_area/.test(normalized)) return 'all_bay_area'
  if (/\beast bay\b|\boakland\b|\bberkeley\b|\bemeryville\b/.test(normalized)) {
    if (/\bsan francisco\b|\bsf\b|\bsoma\b|\bdowntown\b/.test(normalized)) return 'all_bay_area'
    return 'east_bay'
  }
  if (/\bsouth bay\b|\bsan jose\b|\bsunnyvale\b|\bpalo alto\b/.test(normalized)) return 'south_bay'
  if (/\bnorth bay\b|\bmarin\b|\bnapa\b|\bsonoma\b/.test(normalized)) return 'north_bay'
  if (/\bsan francisco\b|\bsf\b|\bsoma\b|\bdowntown\b|\bmission\b/.test(normalized)) return 'sf_only'

  return 'all_bay_area'
}

function cleanStringOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || null
}

function normalizeCollaboratorEmails(values: string[] | null | undefined) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  ))
}

function normalizeServicesOffered(input: VendorSetupInput) {
  const serviceLabels = Array.isArray(input.servicesOffered) ? input.servicesOffered : []
  const values = serviceLabels
    .map((service) => service.trim())
    .filter(Boolean)

  if (values.length === 0) {
    const fallback = SERVICE_TYPE_LABELS[input.serviceType]
    return fallback ? [fallback] : [input.serviceType]
  }

  return Array.from(new Set(values))
}

export async function ensureBuilderTicketingConnections(
  admin: SupabaseLikeClient,
  builderId: string,
  platforms: TicketPlatform[],
  origin?: string
) {
  const uniquePlatforms = Array.from(new Set(platforms))

  for (const platform of uniquePlatforms) {
    const { data, error } = await admin
      .from('builder_ticketing_connections')
      .upsert(
        {
          builder_id: builderId,
          platform,
          status: platform === 'eventbrite' ? 'setup_required' : 'selected',
          config: {
            selected_during_onboarding: true,
          },
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'builder_id,platform' }
      )
      .select('id')
      .single()

    if (error) {
      if (isMissingTicketingConnectionsTable(error)) {
        console.warn(
          '[account-setup] Skipping builder ticketing connection setup because builder_ticketing_connections is unavailable.'
        )
        return
      }

      throw new Error(`Failed to save ${platform} ticketing connection: ${error.message}`)
    }

    if (origin && platform !== 'eventbrite') {
      const webhookUrl = getAccountWebhookUrl(origin, platform, (data as { id: string }).id)
      const { error: webhookError } = await admin
        .from('builder_ticketing_connections')
        .update({
          webhook_url: webhookUrl,
          status: 'setup_required',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', (data as { id: string }).id)

      if (webhookError) {
        throw new Error(`Failed to save ${platform} webhook URL: ${webhookError.message}`)
      }
    }
  }
}

export async function getBuilderConnectedTicketingPlatforms(
  admin: SupabaseLikeClient,
  userId: string
): Promise<TicketPlatform[]> {
  const { data: builderProfile, error: builderError } = await admin
    .from('builder_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (builderError || !builderProfile) {
    if (builderError) {
      console.error('[account-setup] Failed to load builder profile for ticketing connections', builderError)
    }
    return []
  }

  const { data, error } = await admin
    .from('builder_ticketing_connections')
    .select('platform, status, last_connected_at, updated_at')
    .eq('builder_id', (builderProfile as { id: string }).id)
    .order('last_connected_at', { ascending: false, nullsFirst: false })

  if (error) {
    if (isMissingTicketingConnectionsTable(error)) return []
    console.error('[account-setup] Failed to load builder ticketing connections', error)
    return []
  }

  return Array.from(new Set(
    ((data ?? []) as Array<{ platform?: unknown; status?: unknown }>)
      .filter((connection) => connection.status === 'connected')
      .map((connection) => typeof connection.platform === 'string' ? connection.platform : null)
      .filter((platform): platform is TicketPlatform => Boolean(platform && ticketPlatformSet.has(platform)))
  ))
}

export async function ensureBuilderProfile(admin: SupabaseLikeClient, input: BuilderSetupInput) {
  const now = new Date().toISOString()
  const eventTypes = normalizeBuilderEventTypes(input.eventTypes)
  const preferredAmenities = normalizeBuilderAmenityPreferences(input.preferredAmenities)

  const { data, error } = await admin
    .from('builder_profiles')
    .upsert(
      {
        user_id: input.userId,
        name: input.name,
        organization_name: input.organizationName,
        organization_type: cleanStringOrNull(input.organizationType),
        social_handle: cleanStringOrNull(input.socialHandle),
        website: cleanStringOrNull(input.website),
        bio: cleanStringOrNull(input.bio),
        event_types: eventTypes,
        priorities: preferredAmenities,
        preferred_ticket_platforms: input.ticketPlatforms,
        typical_attendance_min: input.typicalAttendanceMin ?? null,
        typical_attendance_max: input.typicalAttendanceMax ?? null,
        bulk_booking_enabled: Boolean(input.bulkBookingEnabled),
        invite_collaborators: normalizeCollaboratorEmails(input.inviteCollaborators),
        signup_metadata: {
          ticketing_setup_optional: true,
          gmail_permission_requested_separately: true,
        },
        updated_at: now,
      } as never,
      { onConflict: 'user_id' }
    )
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to save builder profile: ${error.message}`)
  }

  const builderId = (data as { id: string }).id
  await ensureBuilderTicketingConnections(admin, builderId, input.ticketPlatforms, input.origin)
  return builderId
}

export async function ensureOwnerProfile(admin: SupabaseLikeClient, input: VenueSetupInput) {
  const { error } = await admin
    .from('owner_profiles')
    .upsert(
      {
        user_id: input.userId,
        name: input.contactName,
        phone: input.phone ?? null,
        business_name: input.venueName,
        business_type: input.venueType,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'user_id' }
    )

  if (error) {
    throw new Error(`Failed to save owner profile: ${error.message}`)
  }
}

export async function ensureVenueSetup(admin: SupabaseLikeClient, input: VenueSetupInput) {
  let venueId: string
  const depositAmountCents = toIntegerCentsOrNull(input.deposit)
  const supportedCommercialTerms = normalizeVenueCommercialTerms(input.supportedCommercialTerms)
  const supportsMinimumSpend = supportedCommercialTerms.includes('minimum_spend')
  const supportsBarConsumptionChi = supportedCommercialTerms.includes('bar_consumption_chi')
  const supportsTicketChi = supportedCommercialTerms.includes('ticket_chi')
  const supportsPerAttendeeChi = supportedCommercialTerms.includes('per_attendee_chi')
  const minimumSpendCents = supportsMinimumSpend ? toIntegerCentsOrNull(input.minBarSpend) : null
  // The historical signup defect triple-wrote only these three *_cents fields;
  // it never wrote the legacy dollar aliases, so those are intentionally not
  // part of this reconciliation read.
  const existingVenueQuery = input.claimVenueId
    ? admin.from('venues').select('id, hourly_rate_cents, daily_rate_cents, price_per_night_cents, auto_approve_conditions').eq('id', input.claimVenueId).maybeSingle()
    : admin.from('venues').select('id, hourly_rate_cents, daily_rate_cents, price_per_night_cents, auto_approve_conditions').eq('owner_id', input.userId).maybeSingle()

  const { data: existingVenue, error: existingVenueError } = await existingVenueQuery

  if (existingVenueError) {
    throw new Error(`Failed to verify venue profile: ${existingVenueError.message}`)
  }

  const rateReconciliation = buildVenueNightlyRateReconciliation({
    pricePerNightDollars: input.pricePerNight,
    existing: existingVenue as Record<string, unknown> | null,
  })
  const autoApproveConditions = {
    ...rateReconciliation.auto_approve_conditions,
    ...(supportedCommercialTerms.length > 0 && {
      commercial_terms_supported: supportedCommercialTerms,
      chi_rate_source: 'system_calculated',
      chi_approval_policy: '3rdPlace recommends CHI from event context; venue approval is required before settlement.',
    }),
    ...(minimumSpendCents !== null && { minimum_spend_cents: minimumSpendCents }),
    ...(input.neighborhood?.trim() && { neighborhood: input.neighborhood.trim() }),
  }

  const hasBar = input.hasBar ?? false
  const venuePayload = {
    owner_id: input.userId,
    venue_name: input.venueName,
    address: input.address,
    city: input.city,
    state: input.state.toUpperCase(),
    zip_code: input.zipCode,
    venue_type: input.venueType,
    standing_capacity: input.capacity,
    seated_capacity: input.capacity,
    ...rateReconciliation,
    bar_revenue_share_enabled: hasBar && supportsBarConsumptionChi,
    ticket_sales_share_enabled: supportsTicketChi,
    offers_kickbacks: hasBar && (supportsBarConsumptionChi || supportsTicketChi || supportsPerAttendeeChi),
    bar_revenue_percentage: hasBar && supportsBarConsumptionChi ? input.barKickbackPct ?? null : null,
    bar_revenue_share_percent: hasBar && supportsBarConsumptionChi ? input.perHeadDrinkPct ?? null : null,
    deposit_amount_cents: depositAmountCents,
    deposit_type: depositAmountCents === null ? null : 'fixed',
    requires_deposit: depositAmountCents !== null,
    cancellation_terms: input.cancellationTerms ?? null,
    available_days: input.availableDays ?? null,
    open_from: input.openFrom ?? null,
    open_to: input.openTo ?? null,
    loading_address: input.loadingAddress ?? null,
    prep_time_hours: input.prepTimeHours ?? null,
    is_published: true,
    is_claimed: true,
    claimed_user_id: input.userId,
    is_admin_seeded: false,
    auto_approve_conditions: autoApproveConditions,
    updated_at: new Date().toISOString(),
  }

  if ((existingVenue as { id: string } | null)?.id) {
    venueId = (existingVenue as { id: string }).id
    const { error } = await admin
      .from('venues')
      .update(venuePayload as never)
      .eq('id', venueId)

    if (error) {
      throw new Error(`Failed to update venue profile: ${error.message}`)
    }
  } else {
    const { data: createdVenue, error } = await admin
      .from('venues')
      .insert(venuePayload as never)
      .select('id')
      .single()

    if (error) {
      throw new Error(`Failed to create venue profile: ${error.message}`)
    }

    venueId = (createdVenue as { id: string }).id
  }

  const { error: deleteRulesError } = await admin
    .from('venue_requirements')
    .delete()
    .eq('venue_id', venueId)

  if (deleteRulesError) {
    throw new Error(`Failed to reset venue rules: ${deleteRulesError.message}`)
  }

  const modernRulePayload = {
    venue_id: venueId,
    requirement_type: 'rules',
    requirement_description: input.houseRules,
    is_mandatory: true,
  }
  const legacyRulePayload = {
    venue_id: venueId,
    requirement_type: 'custom',
    description: input.houseRules,
    is_required: true,
  }

  const { error: insertRuleError } = await admin
    .from('venue_requirements')
    .insert(modernRulePayload as never)

  if (insertRuleError) {
    const { error: legacyRuleError } = await admin
      .from('venue_requirements')
      .insert(legacyRulePayload as never)

    if (legacyRuleError) {
      throw new Error(`Failed to save venue rules: ${legacyRuleError.message}`)
    }
  }

  const { error: deleteAmenitiesError } = await admin
    .from('venue_amenities')
    .delete()
    .eq('venue_id', venueId)

  if (deleteAmenitiesError) {
    throw new Error(`Failed to reset venue amenities: ${deleteAmenitiesError.message}`)
  }

  if (input.amenities.length > 0) {
    const { error: insertAmenitiesError } = await admin
      .from('venue_amenities')
      .insert(
        input.amenities.map((amenityId) => ({
          venue_id: venueId,
          amenity_name: VENUE_AMENITY_LABEL_BY_ID[amenityId] || amenityId,
        })) as never
      )

    if (insertAmenitiesError) {
      throw new Error(`Failed to save venue amenities: ${insertAmenitiesError.message}`)
    }
  }

  return venueId
}

export async function ensureVendorProfile(admin: SupabaseLikeClient, input: VendorSetupInput) {
  const now = new Date().toISOString()
  const vendorType = SERVICE_TYPE_LABELS[input.serviceType]
  const depositPercentage = toPositivePercentageOrNull(input.depositPct)
  const displayName = input.businessName?.trim() || input.name
  const servicesOffered = normalizeServicesOffered(input)

  const vendorPayload = {
    user_id: input.userId,
    name: displayName,
    phone: input.phone ?? null,
    vendor_type: vendorType,
    service_type: input.serviceType,
    services_offered: servicesOffered,
    bank_account_holder_name: input.bankAccountHolderName?.trim() || null,
    bank_name: input.bankName?.trim() || null,
    availability_notes: input.availabilityNotes,
    service_area: normalizeVendorServiceArea(input.serviceArea),
    regions_served: input.serviceArea ?? null,
    portfolio_url: input.portfolioUrl ?? null,
    base_rate: input.basePrice != null ? Math.round(input.basePrice * 100) : null,
    deposit_percentage: depositPercentage,
    requires_deposit: depositPercentage !== null,
    lead_time_days: input.leadTimeDays ?? null,
    cancellation_terms: input.cancellationTerms ?? null,
    emergency_available: input.emergencyAvailable ?? null,
    emergency_rate_uplift: input.emergencyRateUplift ?? null,
    bio: input.bio?.trim() || input.availabilityNotes,
    deposit_type: depositPercentage !== null ? 'percentage' : null,
    is_published: true,
    is_claimed: true,
    claimed_user_id: input.userId,
    is_admin_seeded: false,
    updated_at: now,
  }

  const { data: existingVendor, error: existingVendorError } = await admin
    .from('vendor_profiles')
    .select('id')
    .eq('user_id', input.userId)
    .maybeSingle()

  if (existingVendorError) {
    throw new Error(`Failed to verify vendor profile: ${existingVendorError.message}`)
  }

  if ((existingVendor as { id: string } | null)?.id) {
    const vendorId = (existingVendor as { id: string }).id
    const { error } = await admin
      .from('vendor_profiles')
      .update(vendorPayload as never)
      .eq('id', vendorId)

    if (error) {
      throw new Error(`Failed to update vendor profile: ${error.message}`)
    }
    await ensureVendorStarterPackage(admin, vendorId, input)
    return
  }

  const { data, error } = await admin
    .from('vendor_profiles')
    .insert(vendorPayload as never)
    .select('id')
    .single()

  if (error) {
    throw new Error(`Failed to create vendor profile: ${error.message}`)
  }

  await ensureVendorStarterPackage(admin, (data as { id: string }).id, input)
}

async function ensureVendorStarterPackage(admin: SupabaseLikeClient, vendorId: string, input: VendorSetupInput) {
  const packageName = cleanStringOrNull(input.packageName)
  if (!packageName) return

  const { data: existingPackage, error: existingError } = await admin
    .from('vendor_packages')
    .select('id')
    .eq('vendor_id', vendorId)
    .eq('display_order', 0)
    .maybeSingle()

  if (existingError) {
    throw new Error(`Failed to verify starter package: ${existingError.message}`)
  }

  const packagePayload = {
    vendor_id: vendorId,
    package_name: packageName,
    description: cleanStringOrNull(input.packageDetails),
    price: input.basePrice ?? null,
    inclusions: input.packageDetails
      ? input.packageDetails
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)
      : [],
    is_active: true,
    display_order: 0,
  }

  if ((existingPackage as { id: string } | null)?.id) {
    const { error } = await admin
      .from('vendor_packages')
      .update(packagePayload as never)
      .eq('id', (existingPackage as { id: string }).id)

    if (error) throw new Error(`Failed to update starter package: ${error.message}`)
    return
  }

  const { error } = await admin
    .from('vendor_packages')
    .insert(packagePayload as never)

  if (error) {
    throw new Error(`Failed to create starter package: ${error.message}`)
  }
}

export async function getOnboardingStatus(
  supabase: SupabaseLikeClient,
  userId: string,
  userType: UserType,
  companyName?: string | null
) {
  if (userType === 'community_builder') {
    const { data: profile } = await supabase
      .from('builder_profiles')
      .select('id, event_types')
      .eq('user_id', userId)
      .maybeSingle()

    const builder = profile as
      | { id: string; event_types?: string[] | null }
      | null

    const isOnboarded =
      !!builder?.id &&
      !!companyName &&
      (builder.event_types?.length ?? 0) > 0

    return { isOnboarded, redirectPath: isOnboarded ? '/planner' : '/onboarding' }
  }

  if (userType === 'venue_owner') {
    const { data: venue } = await supabase
      .from('venues')
      .select('id, address, standing_capacity, is_admin_seeded, is_claimed')
      .eq('owner_id', userId)
      .maybeSingle()

    const venueData = venue as
      | {
          id: string
          address?: string | null
          standing_capacity?: number | null
          is_admin_seeded?: boolean | null
          is_claimed?: boolean | null
        }
      | null

    if (venueData?.id && venueData.is_admin_seeded && !venueData.is_claimed) {
      return { isOnboarded: false, redirectPath: '/venue/claim-pending' }
    }

    if (!venueData?.id || !venueData.address || !venueData.standing_capacity) {
      return { isOnboarded: false, redirectPath: '/onboarding' }
    }

    const [{ count: amenityCount }, { count: ruleCount }] = await Promise.all([
      supabase
        .from('venue_amenities')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueData.id),
      supabase
        .from('venue_requirements')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueData.id),
    ])

    const isOnboarded = true
    return { isOnboarded, redirectPath: isOnboarded ? '/venue' : '/onboarding' }
  }

  const { data: vendor } = await supabase
    .from('vendor_profiles')
    .select('id, service_type, bank_account_holder_name, bank_name, availability_notes, is_admin_seeded, is_claimed')
    .eq('user_id', userId)
    .maybeSingle()

  const vendorData = vendor as
    | {
        id: string
        service_type?: string | null
        bank_account_holder_name?: string | null
        bank_name?: string | null
        availability_notes?: string | null
        is_admin_seeded?: boolean | null
        is_claimed?: boolean | null
      }
    | null

  if (vendorData?.id && vendorData.is_admin_seeded && !vendorData.is_claimed) {
    return { isOnboarded: false, redirectPath: '/vendor/claim-pending' }
  }

  const isOnboarded =
    !!vendorData?.id &&
    !!vendorData.service_type &&
    !!vendorData.availability_notes

  return { isOnboarded, redirectPath: isOnboarded ? '/vendor' : '/onboarding' }
}
