import { notFound } from 'next/navigation'
import { VenueOpportunityDeclineForm } from '@/components/venue/VenueOpportunityDeclineForm'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { loadVenueOpportunityRecoveryContext } from '@/lib/venues/venueOpportunityRecovery'

export const dynamic = 'force-dynamic'

type VenueOpportunityDeclinePageProps = {
  params: {
    token: string
  }
}

export default async function VenueOpportunityDeclinePage({ params }: VenueOpportunityDeclinePageProps) {
  const admin = createServiceRoleClient()
  const context = await loadVenueOpportunityRecoveryContext(admin, params.token)
  if (!context) notFound()

  return (
    <VenueOpportunityDeclineForm
      token={params.token}
      venueName={readString(context.venue.venue_name) ?? 'Venue'}
      eventTitle={readString(context.brief.title) ?? 'this event'}
    />
  )
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
