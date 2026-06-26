import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { VenueInviteClaimFlow } from '@/components/venue/VenueInviteClaimFlow'
import { VenueOpportunityClaimFlow } from '@/components/venue/VenueOpportunityClaimFlow'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getVenueClaimDetails } from '@/lib/venues/venueClaims'
import { loadVenueOpportunityRecoveryContext } from '@/lib/venues/venueOpportunityRecovery'

export const dynamic = 'force-dynamic'

type VenueClaimPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function VenueClaimPage(props: VenueClaimPageProps) {
  const searchParams = await props.searchParams;
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const token = readSearchParam(resolvedSearchParams.token)
  if (!token) return <ClaimError message="Missing venue opportunity token." />

  const admin = createServiceRoleClient()
  const inviteResult = await getVenueClaimDetails(token)
  if (inviteResult.ok) {
    return (
      <VenueInviteClaimFlow
        token={token}
        details={inviteResult.details}
      />
    )
  }

  const context = await loadVenueOpportunityRecoveryContext(admin, token)
  if (!context) notFound()

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const userRow = user
    ? await admin
        .from('users')
        .select('id, role, user_type')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null }
  const userAccount = (userRow.data as { role?: string | null; user_type?: string | null } | null) ?? null
  const existingOwnerId = typeof context.venue.owner_id === 'string' ? context.venue.owner_id : null
  const userCanClaim = Boolean(
    user &&
      (userAccount?.role === 'owner' || userAccount?.user_type === 'venue_owner') &&
      (!existingOwnerId || existingOwnerId === user.id)
  )

  return (
    <VenueOpportunityClaimFlow
      token={token}
      venueName={readString(context.venue.venue_name) ?? 'this venue'}
      eventTitle={readString(context.brief.title) ?? 'this event'}
      organizerName={readString(context.organizer?.company_name) ?? readString(context.organizer?.name) ?? 'An organizer'}
      alreadyClaimed={Boolean(existingOwnerId)}
      userCanClaim={userCanClaim}
    />
  )
}

function ClaimError({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="max-w-xl rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-primary">Venue claim</p>
        <h1 className="mt-3 font-display text-3xl font-bold">Invite unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="outline">
          <Link href="/login/venue">Venue sign in</Link>
        </Button>
      </section>
    </main>
  )
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
