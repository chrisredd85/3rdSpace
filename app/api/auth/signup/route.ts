export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureBuilderProfile, ensureOwnerProfile, ensureVenueSetup, ensureVendorProfile } from '@/lib/server/account-setup'
import type { TicketPlatform } from '@/lib/constants/account-setup'
import type { UserType } from '@/lib/types'
import type { ServiceType, VenueType } from '@/lib/types'

interface SignupRequest {
  userType: UserType
  email: string
  password: string
  name: string
  phone?: string
  organization_name?: string
  event_types?: string[]
  ticket_platforms?: TicketPlatform[]
  venue_name?: string
  address?: string
  city?: string
  state?: string
  zip_code?: string
  venue_type?: VenueType
  capacity?: number
  house_rules?: string
  amenities?: string[]
  has_bar?: boolean | null
  bar_kickback_pct?: number | null
  per_head_drink_pct?: number | null
  min_bar_spend?: number | null
  price_per_night?: number | null
  deposit?: number | null
  cancellation_terms?: string | null
  available_days?: string[] | null
  open_from?: string | null
  open_to?: string | null
  loading_address?: string | null
  prep_time?: number | null
  service_type?: ServiceType
  service_area?: string | null
  portfolio_url?: string | null
  bio?: string | null
  base_price?: number | null
  package_name?: string | null
  package_details?: string | null
  deposit_pct?: number | null
  lead_time_days?: number | null
  emergency_available?: boolean | null
  emergency_rate_uplift?: number | null
  bank_account_holder_name?: string
  bank_name?: string
  availability_notes?: string
}

interface BuilderSignupDetails {
  organization_name: string
  event_types: string[]
  ticket_platforms: TicketPlatform[]
}

interface VenueSignupDetails {
  contact_name: string
  venue_name: string
  address: string
  city: string
  state: string
  zip_code: string
  venue_type: VenueType
  capacity: number
  house_rules: string
  amenities: string[]
  phone?: string | null
  has_bar?: boolean | null
  bar_kickback_pct?: number | null
  per_head_drink_pct?: number | null
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
  service_type: ServiceType
  bank_account_holder_name: string
  bank_name: string
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

const VALID_TICKETING_PLATFORMS = new Set<TicketPlatform>(['eventbrite', 'luma', 'posh', 'partiful'])

function getRole(userType: UserType): string {
  if (userType === 'community_builder') return 'builder'
  if (userType === 'venue_owner') return 'owner'
  return 'vendor'
}

function getCompanyName(body: SignupRequest): string {
  if (body.userType === 'venue_owner') return body.venue_name || body.name
  if (body.userType === 'vendor') return body.name
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
  const eventTypes = body.event_types
    ?.map((eventType) => eventType.trim())
    .filter(Boolean)
  const ticketPlatforms = body.ticket_platforms
    ?.map((platform) => platform.trim())
    .filter((platform): platform is TicketPlatform => VALID_TICKETING_PLATFORMS.has(platform as TicketPlatform))

  if (!organizationName || !eventTypes?.length || !ticketPlatforms?.length) {
    return null
  }

  return {
    organization_name: organizationName,
    event_types: eventTypes,
    ticket_platforms: ticketPlatforms,
  }
}

function getVenueDetails(body: SignupRequest): VenueSignupDetails | null {
  if (body.userType !== 'venue_owner') return null

  const {
    name,
    venue_name,
    address,
    city,
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
    state: state.toUpperCase(),
    zip_code,
    venue_type,
    capacity,
    house_rules,
    amenities,
    phone: body.phone ?? null,
    has_bar: body.has_bar ?? null,
    bar_kickback_pct: body.bar_kickback_pct ?? null,
    per_head_drink_pct: body.per_head_drink_pct ?? null,
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

  const { name, service_type, bank_account_holder_name, bank_name, availability_notes } = body
  if (!name || !service_type || !bank_account_holder_name || !availability_notes) {
    return null
  }

  return {
    name,
    service_type,
    bank_account_holder_name,
    bank_name: bank_name?.trim() || 'Pending Stripe onboarding',
    availability_notes,
    phone: body.phone ?? null,
    service_area: body.service_area ?? null,
    portfolio_url: body.portfolio_url ?? null,
    bio: body.bio ?? null,
    base_price: body.base_price ?? null,
    package_name: body.package_name ?? null,
    package_details: body.package_details ?? null,
    deposit_pct: body.deposit_pct ?? null,
    lead_time_days: body.lead_time_days ?? null,
    cancellation_terms: body.cancellation_terms ?? null,
    available_days: body.available_days ?? null,
    emergency_available: body.emergency_available ?? null,
    emergency_rate_uplift: body.emergency_rate_uplift ?? null,
  }
}

async function ensureRoleSetup(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  body: SignupRequest,
  builderDetails: BuilderSignupDetails | null,
  venueDetails: VenueSignupDetails | null,
  vendorDetails: VendorSignupDetails | null,
  origin: string
) {
  if (body.userType === 'community_builder' && builderDetails) {
    await ensureBuilderProfile(admin, {
      userId,
      name: body.name,
      organizationName: builderDetails.organization_name,
      eventTypes: builderDetails.event_types,
      ticketPlatforms: builderDetails.ticket_platforms,
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
      contactName: venueDetails.contact_name,
      venueName: venueDetails.venue_name,
      address: venueDetails.address,
      city: venueDetails.city,
      state: venueDetails.state,
      zipCode: venueDetails.zip_code,
      venueType: venueDetails.venue_type,
      capacity: venueDetails.capacity,
      houseRules: venueDetails.house_rules,
      amenities: venueDetails.amenities,
      phone: venueDetails.phone ?? null,
      hasBar: venueDetails.has_bar ?? null,
      barKickbackPct: venueDetails.bar_kickback_pct ?? null,
      perHeadDrinkPct: venueDetails.per_head_drink_pct ?? null,
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
      serviceType: vendorDetails.service_type,
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
    const body: SignupRequest = await request.json()
    const {
      userType,
      email,
      password,
      name,
    } = body

    if (!email || !password || !name || !userType) {
      return NextResponse.json(
        { error: 'Missing required fields: email, password, name, and user type are required.' },
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

    if (userType === 'community_builder' && !builderDetails) {
      return NextResponse.json(
        {
          error:
            'Community builders must provide a point of contact, organization name, event types, and at least one ticket platform.',
        },
        { status: 400 }
      )
    }

    if (userType === 'venue_owner' && !venueDetails) {
      return NextResponse.json(
        {
          error:
            'Venue owners must provide venue name, address, city, state, ZIP code, venue type, house rules, amenities, and capacity.',
        },
        { status: 400 }
      )
    }

    if (userType === 'vendor' && !vendorDetails) {
      return NextResponse.json(
        {
          error:
            'Vendors must provide name, service type, bank account holder name, bank name, and availability details.',
        },
        { status: 400 }
      )
    }

    const { data: existingAppUser, error: existingAppUserError } = await admin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingAppUserError) {
      console.error('Error checking existing app user:', existingAppUserError)
      return NextResponse.json({ error: 'Could not verify account availability.' }, { status: 500 })
    }

    if (existingAppUser) {
      return NextResponse.json(
        { error: 'Account already exists. Please log in instead.' },
        { status: 400 }
      )
    }

    // Create new auth user (metadata so trigger can create public.users if it runs first).
    console.log('Creating new auth user')

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

          try {
            await ensureRoleSetup(admin, signInData.user.id, body, builderDetails, venueDetails, vendorDetails, request.nextUrl.origin)
          } catch (setupError) {
            const setupMessage = setupError instanceof Error ? setupError.message : 'Failed to finish account setup'
            return NextResponse.json({ error: setupMessage }, { status: 500 })
          }

          return NextResponse.json({
            success: true,
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

    console.log('Auth user created:', authData.user.id)

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
      } as never)

    if (userError) {
      // Unique violation = trigger already created public.users (e.g. ON CONFLICT DO NOTHING on trigger side) – treat as success
      const isConflict =
        (userError as { code?: string }).code === '23505' ||
        /duplicate key|unique constraint/i.test(userError.message)
      if (isConflict) {
        console.log('public.users already created (e.g. by trigger), continuing')
      } else {
        console.error('Error creating user profile:', userError)
        await cleanupFailedSignup(admin, authData.user.id)
        return NextResponse.json(
          { error: `Failed to create profile: ${userError.message}` },
          { status: 500 }
        )
      }
    }

    try {
      await ensureRoleSetup(admin, authData.user.id, body, builderDetails, venueDetails, vendorDetails, request.nextUrl.origin)
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

    return NextResponse.json({
      success: true,
      requiresEmailConfirmation: !authData.session,
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
