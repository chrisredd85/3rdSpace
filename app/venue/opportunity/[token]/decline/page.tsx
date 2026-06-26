import { notFound } from 'next/navigation'
import { VenueOpportunityDeclineForm } from '@/components/venue/VenueOpportunityDeclineForm'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadVenueOpportunityRecoveryContext } from '@/lib/venues/venueOpportunityRecovery'

export const dynamic = 'force-dynamic'

type VenueOpportunityDeclinePageProps = {
  params: Promise<{
    token: string
  }>
}

export default async function VenueOpportunityDeclinePage({ params }: VenueOpportunityDeclinePageProps) {
  const { token } = await params
  const admin = createServiceRoleClient()
  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  if (!context) notFound()

  return (
    <VenueOpportunityDeclineForm
      token={token}
      venueName={readString(context.venue.venue_name) ?? 'Venue'}
      eventTitle={readString(context.brief.title) ?? 'this event'}
    />
  )
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
