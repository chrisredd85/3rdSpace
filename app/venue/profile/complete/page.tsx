import { redirect } from 'next/navigation'
import { VenueProfileCompletionForm } from '@/components/venue/VenueProfileCompletionForm'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type VenueProfileCompletePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function VenueProfileCompletePage({ searchParams }: VenueProfileCompletePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const opportunityToken = readSearchParam(resolvedSearchParams.opportunity_token)
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const redirectTarget = `/venue/profile/complete${opportunityToken ? `?opportunity_token=${encodeURIComponent(opportunityToken)}` : ''}`
    redirect(`/login/venue?redirect=${encodeURIComponent(redirectTarget)}`)
  }

  const admin = createServiceRoleClient()
  const { data: venue } = await admin
    .from('venues')
    .select('venue_name, address, city, state, zip_code, standing_capacity, venue_type, contact_email')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const row = (venue as Record<string, unknown> | null) ?? {}

  return (
    <VenueProfileCompletionForm
      opportunityToken={opportunityToken}
      initialValues={{
        venueName: readString(row.venue_name),
        address: readString(row.address),
        city: readString(row.city),
        state: readString(row.state),
        zipCode: readString(row.zip_code),
        capacity: readNumber(row.standing_capacity),
        venueType: readString(row.venue_type),
        contactEmail: readString(row.contact_email) || user.email || '',
      }}
    />
  )
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
