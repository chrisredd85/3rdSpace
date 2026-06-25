export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeLegacyKeys } from '@/lib/api/legacy-key-compat'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureBuilderProfile, ensureOwnerProfile, ensureVenueSetup, ensureVendorProfile } from '@/lib/server/account-setup'
import { LEGAL_TERMS_VERSION } from '@/lib/legal/constants'
import type { TicketPlatform } from '@/lib/constants/account-setup'
import type { UserType } from '@/lib/types'
import type { ServiceType, VenueType } from '@/lib/types'
import {
  claimVenueOpportunityForUser,
  loadVenueOpportunityRecoveryContext,
} from '@/lib/venues/venueOpportunityRecovery'

interface SignupRequest {
  userType: UserType
  email: string
  password: string
  name: string
  phone?: string
  organization_name?: string
  org_type?: string | null
  organization_type?: string | null
  social_handle?: string | null
  website?: string | null
  avg_attendance?: string | number | null
  typical_attendance_min?: number | string | null
  typical_attendance_max?: number | string | null
  bulk_booking_enabled?: boolean | null
  invite_collaborators?: string | string[] | null
  event_types?: string[]
  preferred_amenities?: string[]
  ticket_platforms?: TicketPlatform[]
  venue_name?: string
  address?: string
  city?: string
  neighborhood?: string | null
  state?: string
  zip_code?: string
  venue_type?: VenueType
  capacity?: number
  house_rules?: string
  amenities?: string[]
  has_bar?: boolean | null
  bar_chi_pct?: number | null
  bar_kickback_pct?: number | null
  per_head_drink_pct?: number | null
  supported_commercial_terms?: string[] | null
  min_bar_spend?: number | null
  price_per_night?: number | null
  deposit?: number | null
  cancellation_terms?: string | null
  available_days?: string[] | null
  open_from?: string | null
  open_to?: string | null
  loading_address?: string | null
  prep_time?: number | null
  business_name?: string | null
  service_type?: ServiceType
  services?: string[] | null
  service_area?: string | null
  portfolio_url?: string | null
  bio?: string | null
  base_price?: number | null
  package_name?: string | null
  package_details?: string | null
  deposit_pct?: number | null
  deposit_percentage?: number | null
  lead_time_days?: number | null
  emergency_available?: boolean | null
  emergency_rate_uplift?: number | null
  bank_account_holder_name?: string
  bank_name?: string
  availability_notes?: string
  opportunity_token?: string | null
  signup_terms_version?: string | null
  signup_terms_accepted?: boolean | null
}

interface BuilderSignupDetails {
  organization_name: string
  organization_type?: string | null
  social_handle?: string | null
  website?: string | null
  bio?: string | null
  event_types: string[]
  preferred_amenities: string[]
  ticket_platforms: TicketPlatform[]
  typical_attendance_min?: number | null
  typical_attendance_max?: number | null
  bulk_booking_enabled?: boolean | null
  invite_collaborators: string[]
}

interface VenueSignupDetails {
  contact_name: string
  venue_name: string
  address: string
  city: string
  neighborhood?: string | null
  state: string
  zip_code: string
  venue_type: VenueType
  capacity: number
  house_rules: string
  amenities: string[]
  phone?: string | null
  has_bar?: boolean | null
  bar_chi_pct?: number | null
  bar_kickback_pct?: number | null
  per_head_drink_pct?: number | null
  supported_commercial_terms?: string[] | null
  min_bar_spend?: number | null
  price_per_night?: number | null
  deposit?: number | null
  cancellation_terms?: string | null
  available_days?: string[] | null
  open_from?: string | null
  open_to?: string | null
  loading_address?: string | null
  prep_time?: number | null
}

interface VendorSignupDetails {
  name: string
  business_name?: string | null
  service_type: ServiceType
  services?: string[]
  bank_account_holder_name?: string | null
  bank_name?: string | null
  availability_notes: string
  phone?: string | null
  service_area?: string | null
  portfolio_url?: string | null
  bio?: string | null
  base_price?: number | null
  package_name?: string | null
  package_details?: string | null
  deposit_pct?: number | null
  lead_time_days?: number | null
  cancellation_terms?: string | null
  available_days?: string[] | null
  emergency_available?: boolean | null
  emergency_rate_uplift?: number | null
}

type SignupTicketingConnection = {
  platform: TicketPlatform
  status: string
  webhook_url: string | null
}

const VALID_TICKETING_PLATFORMS = new Set<TicketPlatform>(['eventbrite', 'luma', 'posh', 'partiful'])

function getRole(userType: UserType): string {
  if (userType === 'community_builder') return 'builder'
  if (userType === 'venue_owner') return 'owner'
  return 'vendor'
}

function getCompanyName(body: SignupRequest): string {
  if (body.userType === 'venue_owner') return body.venue_name || body.name
  if (body.userType === 'vendor') return body.business_name || body.name
  return body.organization_name || body.name
}

function serializeAuthError(error: unknown) {
  if (!error || typeof error !== 'object') return error

  const authError = error as {
    name?: string
    message?: string
    status?: number
    code?: string
    details?: unknown
    hint?: unknown
  }

  return {
    name: authError.name,
    message: authError.message,
    status: authError.status,
    code: authError.code,
    details: authError.details,
    hint: authError.hint,
  }
}

function getBuilderDetails(body: SignupRequest): BuilderSignupDetails | null {
  if (body.userType !== 'community_builder') return null

  const organizationName = body.organization_name?.trim()
  const attendanceRange = parseAttendanceRange(body)
  const eventTypes = body.event_types
    ?.map((eventType) => eventType.trim())
    .filter(Boolean)
  const preferredAmenities = (body.preferred_amenities ?? body.amenities ?? [])
    .map((amenity) => amenity.trim())
    .filter(Boolean)
  const ticketPlatforms = body.ticket_platforms
    ?.map((platform) => platform.trim())
    .filter((platform): platform is TicketPlatform => VALID_TICKETING_PLATFORMS.has(platform as TicketPlatform))
    ?? []

  if (!organizationName || !eventTypes?.length) {
    return null
  }

  return {
    organization_name: organizationName,
    organization_type: body.organization_type?.trim() || body.org_type?.trim() || null,
    social_handle: body.social_handle?.trim() || null,
    website: body.website?.trim() || null,
    bio: body.bio?.trim() || null,
    event_types: eventTypes,
    preferred_amenities: preferredAmenities,
    ticket_platforms: ticketPlatforms,
    typical_attendance_min: attendanceRange.min,
    typical_attendance_max: attendanceRange.max,
    bulk_booking_enabled: body.bulk_booking_enabled ?? false,
    invite_collaborators: normalizeCollaboratorInput(body.invite_collaborators),
  }
}

function getBuilderSignupValidationError(body: SignupRequest): string | null {
  if (body.userType !== 'community_builder') return null
  if (!body.name?.trim()) return 'Missing point of contact name'
  if (!body.organization_name?.trim()) return 'Missing organization name'

  const eventTypes = body.event_types
    ?.map((eventType) => eventType.trim())
    .filter(Boolean)
  if (!eventTypes?.length) return 'Select at least one event type'

  return null
}

function getVenueSignupValidationError(body: SignupRequest): string | null {
  if (body.userType !== 'venue_owner') return null
  if (!body.name?.trim()) return 'Missing point of contact name'
  if (!body.venue_name?.trim()) return 'Missing venue name'
  if (!body.address?.trim()) return 'Missing venue address'
  if (!body.city?.trim()) return 'Missing venue city'
  if (!body.state?.trim()) return 'Missing venue state'
  if (!body.zip_code?.trim()) return 'Missing venue ZIP code'
  if (!body.venue_type) return 'Select a venue type'
  if (!body.capacity || body.capacity <= 0) return 'Enter venue capacity'
  if (!body.house_rules?.trim()) return 'Add venue house rules'
  if (!body.amenities?.length) return 'Select at least one venue amenity'

  return null
}

function getVendorSignupValidationError(body: SignupRequest): string | null {
  if (body.userType !== 'vendor') return null
  if (!body.name?.trim()) return 'Missing vendor contact name'
  if (!body.service_type) return 'Select at least one vendor service'
  if (!body.availability_notes?.trim() && !body.available_days?.length) {
    return 'Add vendor availability details'
  }

  return null
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[$,%\s,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseAttendanceRange(body: SignupRequest): { min: number | null; max: number | null } {
  const explicitMin = parseOptionalNumber(body.typical_attendance_min)
  const explicitMax = parseOptionalNumber(body.typical_attendance_max)
  if (explicitMin !== null || explicitMax !== null) {
    const min = explicitMin === null ? explicitMax : explicitMin
    const max = explicitMax === null ? explicitMin : explicitMax
    return normalizeRange(min, max)
  }

  const value = body.avg_attendance
  if (value === null || value === undefined || value === '') return { min: null, max: null }
  if (typeof value === 'number') return normalizeRange(value, value)

  const normalized = value.replace(/,/g, '').trim()
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d+(?:\.\d+)?)/i)
  if (range) {
    return normalizeRange(Number.parseFloat(range[1]), Number.parseFloat(range[2]))
  }

  const openEnded = normalized.match(/(\d+(?:\.\d+)?)\s*\+/)
  if (openEnded) {
    const min = Number.parseFloat(openEnded[1])
    return normalizeRange(min, null)
  }

  const single = parseOptionalNumber(normalized)
  return single === null ? { min: null, max: null } : normalizeRange(single, single)
}

function normalizeRange(minValue: number | null, maxValue: number | null) {
  const min = minValue === null ? null : Math.max(0, Math.round(minValue))
  const max = maxValue === null ? null : Math.max(0, Math.round(maxValue))
  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }
  return { min, max }
}

function normalizeCollaboratorInput(value: SignupRequest['invite_collaborators']) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,;\n]/)
      : []

  return Array.from(new Set(
    values
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item))
  ))
}

function getRoleSignupValidationError(body: SignupRequest): string | null {
  return (
    getBuilderSignupValidationError(body) ??
    getVenueSignupValidationError(body) ??
    getVendorSignupValidationError(body)
  )
}

function getVenueDetails(body: SignupRequest): VenueSignupDetails | null {
  if (body.userType !== 'venue_owner') return null

  const {
    name,
    venue_name,
    address,
    city,
    neighborhood,
    state,
    zip_code,
    venue_type,
    capacity,
    house_rules,
    amenities,
  } = body
  if (!name || !venue_name || !address || !city || !state || !zip_code || !venue_type || !capacity || !house_rules || !(amenities?.length)) {
    return null
  }

  return {
    contact_name: name,
    venue_name,
    address,
    city,
    neighborhood: neighborhood?.trim() || null,
    state: state.toUpperCase(),
    zip_code,
    venue_type,
    capacity,
    house_rules,
    amenities,
    phone: body.phone ?? null,
    has_bar: body.has_bar ?? null,
    bar_chi_pct: body.bar_chi_pct ?? body.bar_kickback_pct ?? null,
    bar_kickback_pct: body.bar_kickback_pct ?? null,
    per_head_drink_pct: body.per_head_drink_pct ?? null,
    supported_commercial_terms: normalizeVenueCommercialTerms(body.supported_commercial_terms),
    min_bar_spend: body.min_bar_spend ?? null,
    price_per_night: body.price_per_night ?? null,
    deposit: body.deposit ?? null,
    cancellation_terms: body.cancellation_terms ?? null,
    available_days: body.available_days ?? null,
    open_from: body.open_from ?? null,
    open_to: body.open_to ?? null,
    loading_address: body.loading_address ?? null,
    prep_time: body.prep_time ?? null,
  }
}

function getVendorDetails(body: SignupRequest): VendorSignupDetails | null {
  if (body.userType !== 'vendor') return null

  const { name, business_name, service_type, bank_account_holder_name, bank_name } = body
  const availabilityNotes =
    body.availability_notes?.trim() ||
    (body.available_days?.length ? `Available ${body.available_days.join(', ')}` : '')

  if (!name || !service_type || !availabilityNotes) {
    return null
  }

  return {
    name,
    business_name: business_name?.trim() || null,
    service_type,
    services: body.services?.map((service) => service.trim()).filter(Boolean) ?? [],
    bank_account_holder_name: bank_account_holder_name?.trim() || null,
    bank_name: bank_name?.trim() || null,
    availability_notes: availabilityNotes,
    phone: body.phone ?? null,
    service_area: body.service_area ?? null,
    portfolio_url: body.portfolio_url ?? null,
    bio: body.bio ?? null,
    base_price: parseOptionalNumber(body.base_price),
    package_name: body.package_name ?? null,
    package_details: body.package_details ?? null,
    deposit_pct: parseOptionalNumber(body.deposit_pct ?? body.deposit_percentage),
    lead_time_days: parseOptionalNumber(body.lead_time_days),
    cancellation_terms: body.cancellation_terms ?? null,
    available_days: body.available_days ?? null,
    emergency_available: body.emergency_available ?? null,
    emergency_rate_uplift: parseOptionalNumber(body.emergency_rate_uplift),
  }
}

async function ensureRoleSetup(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  body: SignupRequest,
  builderDetails: BuilderSignupDetails | null,
  venueDetails: VenueSignupDetails | null,
  vendorDetails: VendorSignupDetails | null,
  origin: string,
  venueClaimVenueId?: string | null
) {
  if (body.userType === 'community_builder' && builderDetails) {
    await ensureBuilderProfile(admin, {
      userId,
      name: body.name,
      organizationName: builderDetails.organization_name,
      organizationType: builderDetails.organization_type ?? null,
      socialHandle: builderDetails.social_handle ?? null,
      website: builderDetails.website ?? null,
      bio: builderDetails.bio ?? null,
      eventTypes: builderDetails.event_types,
      preferredAmenities: builderDetails.preferred_amenities,
      ticketPlatforms: builderDetails.ticket_platforms,
      typicalAttendanceMin: builderDetails.typical_attendance_min ?? null,
      typicalAttendanceMax: builderDetails.typical_attendance_max ?? null,
      bulkBookingEnabled: builderDetails.bulk_booking_enabled ?? false,
      inviteCollaborators: builderDetails.invite_collaborators,
      origin,
    })
    return
  }

  if (body.userType === 'venue_owner' && venueDetails) {
    await ensureOwnerProfile(admin, {
      userId,
      contactName: venueDetails.contact_name,
      venueName: venueDetails.venue_name,
      address: venueDetails.address,
      city: venueDetails.city,
      neighborhood: venueDetails.neighborhood ?? null,
      state: venueDetails.state,
      zipCode: venueDetails.zip_code,
      venueType: venueDetails.venue_type,
      capacity: venueDetails.capacity,
      houseRules: venueDetails.house_rules,
      amenities: venueDetails.amenities,
      phone: venueDetails.phone ?? null,
    })
    await ensureVenueSetup(admin, {
      userId,
      claimVenueId: venueClaimVenueId ?? null,
      contactName: venueDetails.contact_name,
      venueName: venueDetails.venue_name,
      address: venueDetails.address,
      city: venueDetails.city,
      neighborhood: venueDetails.neighborhood ?? null,
      state: venueDetails.state,
      zipCode: venueDetails.zip_code,
      venueType: venueDetails.venue_type,
      capacity: venueDetails.capacity,
      houseRules: venueDetails.house_rules,
      amenities: venueDetails.amenities,
      phone: venueDetails.phone ?? null,
      hasBar: venueDetails.has_bar ?? null,
      barKickbackPct: venueDetails.bar_chi_pct ?? null,
      perHeadDrinkPct: venueDetails.per_head_drink_pct ?? null,
      supportedCommercialTerms: venueDetails.supported_commercial_terms ?? null,
      minBarSpend: venueDetails.min_bar_spend ?? null,
      pricePerNight: venueDetails.price_per_night ?? null,
      deposit: venueDetails.deposit ?? null,
      cancellationTerms: venueDetails.cancellation_terms ?? null,
      availableDays: venueDetails.available_days ?? null,
      openFrom: venueDetails.open_from ?? null,
      openTo: venueDetails.open_to ?? null,
      loadingAddress: venueDetails.loading_address ?? null,
      prepTimeHours: venueDetails.prep_time ?? null,
    })
    return
  }

  if (body.userType === 'vendor' && vendorDetails) {
    await ensureVendorProfile(admin, {
      userId,
      name: vendorDetails.name,
      businessName: vendorDetails.business_name ?? null,
      serviceType: vendorDetails.service_type,
      servicesOffered: vendorDetails.services ?? [],
      bankAccountHolderName: vendorDetails.bank_account_holder_name,
      bankName: vendorDetails.bank_name,
      availabilityNotes: vendorDetails.availability_notes,
      phone: vendorDetails.phone ?? null,
      serviceArea: vendorDetails.service_area ?? null,
      portfolioUrl: vendorDetails.portfolio_url ?? null,
      bio: vendorDetails.bio ?? null,
      basePrice: vendorDetails.base_price ?? null,
      packageName: vendorDetails.package_name ?? null,
      packageDetails: vendorDetails.package_details ?? null,
      depositPct: vendorDetails.deposit_pct ?? null,
      leadTimeDays: vendorDetails.lead_time_days ?? null,
      cancellationTerms: vendorDetails.cancellation_terms ?? null,
      availableDays: vendorDetails.available_days ?? null,
      emergencyAvailable: vendorDetails.emergency_available ?? null,
      emergencyRateUplift: vendorDetails.emergency_rate_uplift ?? null,
    })
  }
}

async function loadBuilderSignupTicketingConnections(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string
): Promise<SignupTicketingConnection[]> {
  const { data: builderProfile, error: builderError } = await admin
    .from('builder_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (builderError || !builderProfile) {
    if (builderError) {
      console.error('Failed to load builder profile for signup ticketing connections:', builderError)
    }
    return []
  }

  const { data, error } = await admin
    .from('builder_ticketing_connections')
    .select('platform, status, webhook_url')
    .eq('builder_id', (builderProfile as { id: string }).id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to load signup ticketing connections:', error)
    return []
  }

  return ((data ?? []) as Array<{ platform?: unknown; status?: unknown; webhook_url?: unknown }>)
    .map((connection) => ({
      platform: typeof connection.platform === 'string' && VALID_TICKETING_PLATFORMS.has(connection.platform as TicketPlatform)
        ? connection.platform as TicketPlatform
        : null,
      status: typeof connection.status === 'string' ? connection.status : 'setup_required',
      webhook_url: typeof connection.webhook_url === 'string' ? connection.webhook_url : null,
    }))
    .filter((connection): connection is SignupTicketingConnection => Boolean(connection.platform))
}

function getVenueOpportunityToken(body: SignupRequest) {
  if (body.userType !== 'venue_owner') return null
  const token = body.opportunity_token?.trim()
  return token && token.length <= 256 ? token : null
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

async function resolveVenueClaimVenueId(
  admin: ReturnType<typeof createServiceRoleClient>,
  token: string | null
) {
  if (!token) return null
  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  const venueId = context?.venue.id
  return typeof venueId === 'string' ? venueId : null
}

async function completeVenueOpportunityClaimAfterSignup(
  admin: ReturnType<typeof createServiceRoleClient>,
  body: SignupRequest,
  userId: string
) {
  const token = getVenueOpportunityToken(body)
  if (!token) return null

  const result = await claimVenueOpportunityForUser(admin, {
    token,
    userId,
  })

  if (!result.ok) {
    throw new Error(result.error)
  }

  return result.redirectTo
}

async function cleanupFailedSignup(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string
) {
  const cleanupSteps = [
    () => admin.from('builder_profiles').delete().eq('user_id', userId),
    () => admin.from('owner_profiles').delete().eq('user_id', userId),
    () => admin.from('vendor_profiles').delete().eq('user_id', userId),
    () => admin.from('users').delete().eq('id', userId),
  ]

  for (const step of cleanupSteps) {
    try {
      const { error } = await step()
      if (error) console.error('Signup cleanup step failed:', error)
    } catch (cleanupError) {
      console.error('Signup cleanup step threw:', cleanupError)
    }
  }

  try {
    await admin.auth.admin.deleteUser(userId)
  } catch (cleanupError) {
    console.error('Cleanup error (delete auth user):', cleanupError)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SignupRequest = normalizeLegacyKeys(
      await request.json(),
      { bar_kickback_pct: 'bar_chi_pct' },
      { route: '/api/auth/signup', direction: 'request' }
    ) as SignupRequest
    const {
      userType,
      email,
      password,
      name,
    } = body

    if (!email?.trim() || !password || !userType) {
      return NextResponse.json(
        { error: 'Missing required fields: email, password, and user type are required.' },
        { status: 400 }
      )
    }

    if (body.signup_terms_accepted !== true || body.signup_terms_version !== LEGAL_TERMS_VERSION) {
      return NextResponse.json(
        { error: 'You must accept the current Terms of Service and Privacy Policy to create an account.' },
        { status: 400 }
      )
    }

    const roleValidationError = getRoleSignupValidationError(body)
    if (roleValidationError) {
      return NextResponse.json(
        { error: roleValidationError },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const role = getRole(userType)
    const companyName = getCompanyName(body)
    const builderDetails = getBuilderDetails(body)
    const venueDetails = getVenueDetails(body)
    const vendorDetails = getVendorDetails(body)
    const venueOpportunityToken = getVenueOpportunityToken(body)
    const venueClaimVenueId = await resolveVenueClaimVenueId(admin, venueOpportunityToken)

    if (userType === 'community_builder' && !builderDetails) {
      return NextResponse.json(
        { error: 'Creator signup details are invalid. Check organization and event types.' },
        { status: 400 }
      )
    }

    if (userType === 'venue_owner' && !venueDetails) {
      return NextResponse.json(
        { error: 'Venue signup details are invalid. Check venue details, capacity, house rules, and amenities.' },
        { status: 400 }
      )
    }

    if (userType === 'vendor' && !vendorDetails) {
      return NextResponse.json(
        { error: 'Vendor signup details are invalid. Check contact, service type, and availability details.' },
        { status: 400 }
      )
    }

    const { data: existingAppUser, error: existingAppUserError } = await admin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingAppUserError) {
      console.warn('App user availability preflight failed; continuing with Supabase Auth as source of truth:', existingAppUserError)
    } else if (existingAppUser) {
      return NextResponse.json(
        { error: 'Account already exists. Please log in instead.' },
        { status: 400 }
      )
    }

    // Create new auth user (metadata so trigger can create public.users if it runs first).
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          role,
          user_type: userType,
          company_name: companyName,
        },
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback`,
      },
    })

    if (authError) {
      console.error('Auth signup error:', serializeAuthError(authError))
      let message = authError.message || 'Failed to create account'
      const status = message.toLowerCase().includes('already') || authError.status === 422 ? 400 : 500
      // "Database error saving new user" usually means a DB trigger on auth.users failed (e.g. insert into public.users)
      if (message.includes('Database error saving new user')) {
        message = 'Signup failed while creating your user profile. Please try again or contact support.'
      }
      if (message.toLowerCase().includes('already')) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (!signInError && signInData.user) {
          const { error: recoveredUserError } = await admin
            .from('users')
            .insert({
              id: signInData.user.id,
              email: signInData.user.email!,
              role,
              user_type: userType,
              company_name: companyName,
              email_verified: Boolean(signInData.user.email_confirmed_at),
              signup_terms_version: LEGAL_TERMS_VERSION,
              signup_terms_accepted_at: new Date().toISOString(),
            } as never)

          if (recoveredUserError) {
            const isConflict =
              (recoveredUserError as { code?: string }).code === '23505' ||
              /duplicate key|unique constraint/i.test(recoveredUserError.message)

            if (!isConflict) {
              console.error('Error creating recovered user profile:', recoveredUserError)
              return NextResponse.json(
                { error: `Failed to create profile: ${recoveredUserError.message}` },
                { status: 500 }
              )
            }
          }

          let redirectTo: string | null = null
          try {
            await ensureRoleSetup(admin, signInData.user.id, body, builderDetails, venueDetails, vendorDetails, request.nextUrl.origin, venueClaimVenueId)
            redirectTo = await completeVenueOpportunityClaimAfterSignup(admin, body, signInData.user.id)
          } catch (setupError) {
            const setupMessage = setupError instanceof Error ? setupError.message : 'Failed to finish account setup'
            return NextResponse.json({ error: setupMessage }, { status: 500 })
          }

          const ticketingConnections =
            userType === 'community_builder'
              ? await loadBuilderSignupTicketingConnections(admin, signInData.user.id)
              : []

          return NextResponse.json({
            success: true,
            redirectTo,
            ticketingConnections,
            user: {
              id: signInData.user.id,
              email: signInData.user.email,
            },
          })
        }

        message = 'Account already exists. Please log in instead.'
      }
      return NextResponse.json(
        {
          error: message,
          ...(process.env.NODE_ENV !== 'production' && {
            details: serializeAuthError(authError),
          }),
        },
        { status }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Signup succeeded but no user was returned. Please try again.' },
        { status: 500 }
      )
    }

    // Step 3: Create app user profile (idempotent with trigger: if trigger ran first with ON CONFLICT DO NOTHING, this may duplicate – we treat conflict as success)
    const { error: userError } = await admin
      .from('users')
      .insert({
        id: authData.user.id,
        email: authData.user.email!,
        role,
        user_type: userType,
        company_name: companyName,
        email_verified: false,
        signup_terms_version: LEGAL_TERMS_VERSION,
        signup_terms_accepted_at: new Date().toISOString(),
      } as never)

    if (userError) {
      // Unique violation = trigger already created public.users (e.g. ON CONFLICT DO NOTHING on trigger side) – treat as success
      const isConflict =
        (userError as { code?: string }).code === '23505' ||
        /duplicate key|unique constraint/i.test(userError.message)
      if (!isConflict) {
        console.error('Error creating user profile:', userError)
        await cleanupFailedSignup(admin, authData.user.id)
        return NextResponse.json(
          { error: `Failed to create profile: ${userError.message}` },
          { status: 500 }
        )
      }
    }

    let venueClaimRedirectTo: string | null = null
    try {
      await ensureRoleSetup(admin, authData.user.id, body, builderDetails, venueDetails, vendorDetails, request.nextUrl.origin, venueClaimVenueId)
      venueClaimRedirectTo = await completeVenueOpportunityClaimAfterSignup(admin, body, authData.user.id)
    } catch (setupError) {
      console.error('Error completing role setup during signup:', setupError)
      await cleanupFailedSignup(admin, authData.user.id)
      return NextResponse.json(
        {
          error:
            setupError instanceof Error ? setupError.message : 'Failed to finish account setup',
        },
        { status: 500 }
      )
    }

    const ticketingConnections =
      userType === 'community_builder'
        ? await loadBuilderSignupTicketingConnections(admin, authData.user.id)
        : []

    return NextResponse.json({
      success: true,
      requiresEmailConfirmation: !authData.session,
      redirectTo: venueClaimRedirectTo,
      ticketingConnections,
      user: {
        id: authData.user.id,
        email: authData.user.email,
      },
    })
  } catch (error: unknown) {
    console.error('Signup error:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    const details = error && typeof error === 'object' && 'details' in error ? (error as { details: unknown }).details : null
    return NextResponse.json(
      {
        error: message,
        ...(details != null && { details }),
      },
      { status: 500 }
    )
  }
}
