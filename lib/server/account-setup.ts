import { SERVICE_TYPE_LABELS, VENUE_AMENITY_LABEL_BY_ID, type TicketPlatform } from '@/lib/constants/account-setup'
import type { ServiceType, UserType, VenueType } from '@/lib/types'

type SupabaseLikeClient = any

export type BuilderSetupInput = {
  userId: string
  name: string
  organizationName: string
  eventTypes: string[]
  ticketPlatforms: TicketPlatform[]
  origin?: string
}

export type VenueSetupInput = {
  userId: string
  contactName: string
  venueName: string
  address: string
  city: string
  state: string
  zipCode: string
  venueType: VenueType
  capacity: number
  houseRules: string
  amenities: string[]
  phone?: string
}

export type VendorSetupInput = {
  userId: string
  name: string
  serviceType: ServiceType
  bankAccountHolderName: string
  bankName: string
  availabilityNotes: string
  phone?: string
}

function getAccountWebhookUrl(origin: string, platform: TicketPlatform, connectionId: string) {
  const url = new URL(`/api/webhooks/${platform}`, origin)
  url.searchParams.set('builderConnectionId', connectionId)
  return url.toString()
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

export async function ensureBuilderProfile(admin: SupabaseLikeClient, input: BuilderSetupInput) {
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('builder_profiles')
    .upsert(
      {
        user_id: input.userId,
        name: input.name,
        event_types: input.eventTypes,
        preferred_ticket_platforms: input.ticketPlatforms,
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

  const { data: existingVenue, error: existingVenueError } = await admin
    .from('venues')
    .select('id')
    .eq('owner_id', input.userId)
    .maybeSingle()

  if (existingVenueError) {
    throw new Error(`Failed to verify venue profile: ${existingVenueError.message}`)
  }

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
    pricing_model: 'hourly',
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

  const { error } = await admin
    .from('vendor_profiles')
    .upsert(
      {
        user_id: input.userId,
        name: input.name,
        phone: input.phone ?? null,
        vendor_type: vendorType,
        service_type: input.serviceType,
        bank_account_holder_name: input.bankAccountHolderName,
        bank_name: input.bankName,
        availability_notes: input.availabilityNotes,
        bio: input.availabilityNotes,
        updated_at: now,
      } as never,
      { onConflict: 'user_id' }
    )

  if (error) {
    throw new Error(`Failed to save vendor profile: ${error.message}`)
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
      .select('id, event_types, preferred_ticket_platforms')
      .eq('user_id', userId)
      .maybeSingle()

    const builder = profile as
      | { id: string; event_types?: string[] | null; preferred_ticket_platforms?: string[] | null }
      | null

    const isOnboarded =
      !!builder?.id &&
      !!companyName &&
      (builder.event_types?.length ?? 0) > 0 &&
      (builder.preferred_ticket_platforms?.length ?? 0) > 0

    return { isOnboarded, redirectPath: isOnboarded ? '/builder' : '/onboarding' }
  }

  if (userType === 'venue_owner') {
    const { data: venue } = await supabase
      .from('venues')
      .select('id, address, standing_capacity')
      .eq('owner_id', userId)
      .maybeSingle()

    const venueData = venue as { id: string; address?: string | null; standing_capacity?: number | null } | null

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
    .select('id, service_type, bank_account_holder_name, bank_name, availability_notes')
    .eq('user_id', userId)
    .maybeSingle()

  const vendorData = vendor as
    | {
        id: string
        service_type?: string | null
        bank_account_holder_name?: string | null
        bank_name?: string | null
        availability_notes?: string | null
      }
    | null

  const isOnboarded =
    !!vendorData?.id &&
    !!vendorData.service_type &&
    !!vendorData.bank_account_holder_name &&
    !!vendorData.bank_name &&
    !!vendorData.availability_notes

  return { isOnboarded, redirectPath: isOnboarded ? '/vendor' : '/onboarding' }
}
