import { notFound } from 'next/navigation'
import { OpportunityResponseForm } from '@/components/opportunities/OpportunityResponseForm'
import {
  getOpportunityResponseContext,
  markOpportunityViewed,
} from '@/lib/opportunities/tokenValidate'
import { createServiceRoleClient } from '@/lib/supabase/server'

interface OpportunityRespondPageProps {
  params: {
    token: string
  }
}

/**
 * Public magic-link response page for venue and vendor opportunity invites.
 */
export default async function OpportunityRespondPage({ params }: OpportunityRespondPageProps) {
  const admin = createServiceRoleClient()
  const opportunity = await getOpportunityResponseContext(admin, params.token)
  if (!opportunity) notFound()

  await markOpportunityViewed(admin, opportunity)

  return <OpportunityResponseForm token={params.token} opportunity={opportunity} />
}
