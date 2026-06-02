import Link from 'next/link'
import type { ReactNode } from 'react'
import { Building2, CheckCircle2, LogIn, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { verifyDiscoveryVenueClaimToken } from '@/lib/outreach/discoveryClaimTokens'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: {
    discoveryVenueId: string
  }
  searchParams: {
    token?: string
    claim_error?: string
    claimed?: string
  }
}

const DISCOVERY_SELECT = `
  id,
  name,
  address,
  neighborhood,
  city,
  state,
  website,
  is_claimed,
  claimed_venue_id
`

export default async function DiscoveryVenueClaimPage({ params, searchParams }: PageProps) {
  const token = searchParams.token ?? ''
  const payload = verifyDiscoveryVenueClaimToken(token)
  if (!payload || payload.discovery_venue_id !== params.discoveryVenueId) {
    return <ClaimShell title="Claim link unavailable" description="This discovery listing claim link is invalid or expired." />
  }

  const admin = createServiceRoleClient() as any
  const { data: discoveryVenue } = await admin
    .from('discovery_venues')
    .select(DISCOVERY_SELECT)
    .eq('id', params.discoveryVenueId)
    .maybeSingle()

  if (!discoveryVenue) {
    return <ClaimShell title="Listing not found" description="We could not find this discovery venue listing." />
  }

  if (discoveryVenue.is_claimed) {
    return <ClaimShell title="Already claimed" description="This discovery listing has already been connected to an onboarded venue profile." />
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const returnPath = `/v/${params.discoveryVenueId}/claim?token=${encodeURIComponent(token)}`
    return (
      <ClaimLayout discoveryVenue={discoveryVenue}>
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <LogIn className="h-5 w-5 text-primary" />
              Sign in to claim
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Use a venue owner account so we can connect this discovery listing to a real venue profile.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="default">
                <Link href={`/login/venue?returnTo=${encodeURIComponent(returnPath)}`}>Sign in</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/signup/venue">Create venue account</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </ClaimLayout>
    )
  }

  if (user.user_metadata?.user_type !== 'venue_owner') {
    return (
      <ClaimLayout discoveryVenue={discoveryVenue}>
        <ClaimShell
          title="Venue owner account required"
          description="Sign in with a venue owner account before claiming this discovery listing."
        />
      </ClaimLayout>
    )
  }

  const { data: venues } = await admin
    .from('venues')
    .select('id, venue_name, address, city, state')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  const ownedVenues = (venues ?? []) as Array<Record<string, unknown>>

  if (searchParams.claimed === '1') {
    return (
      <ClaimLayout discoveryVenue={discoveryVenue}>
        <Card className="rounded-md">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">Listing claimed</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Existing outreach threads for this discovery listing now point at your onboarded venue profile.
              </p>
            </div>
            <Button asChild variant="default">
              <Link href="/venue">Open venue dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </ClaimLayout>
    )
  }

  if (ownedVenues.length === 0) {
    return (
      <ClaimLayout discoveryVenue={discoveryVenue}>
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle className="text-xl">Finish venue setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create your venue profile first, then return to this claim link to connect the discovery listing.
            </p>
            <Button asChild variant="default">
              <Link href="/onboarding">Finish setup</Link>
            </Button>
          </CardContent>
        </Card>
      </ClaimLayout>
    )
  }

  return (
    <ClaimLayout discoveryVenue={discoveryVenue}>
      <Card className="rounded-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Connect this listing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {searchParams.claim_error ? (
            <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-3 text-sm font-semibold text-secondary">
              {searchParams.claim_error}
            </div>
          ) : null}
          <form
            action={`/api/discovery/venues/${params.discoveryVenueId}/claim`}
            method="post"
            className="space-y-4"
          >
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="returnTo" value={`/v/${params.discoveryVenueId}/claim?token=${encodeURIComponent(token)}`} />
            <label className="block text-sm font-semibold text-foreground" htmlFor="venueId">
              Venue profile
            </label>
            <select
              id="venueId"
              name="venueId"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-smooth focus:border-primary"
              defaultValue={String(ownedVenues[0]?.id ?? '')}
            >
              {ownedVenues.map((venue) => (
                <option key={String(venue.id)} value={String(venue.id)}>
                  {String(venue.venue_name ?? 'Venue profile')}
                </option>
              ))}
            </select>
            <Button type="submit" variant="default" className="w-full">
              Claim listing
            </Button>
          </form>
        </CardContent>
      </Card>
    </ClaimLayout>
  )
}

function ClaimLayout({
  discoveryVenue,
  children,
}: {
  discoveryVenue: Record<string, unknown>
  children: ReactNode
}) {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-md border border-border bg-cream p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Venue claim</p>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                {String(discoveryVenue.name ?? 'Discovery venue')}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {[discoveryVenue.address, discoveryVenue.neighborhood, discoveryVenue.city, discoveryVenue.state]
                  .filter(Boolean)
                  .map(String)
                  .join(', ') || 'Bay Area'}
              </p>
            </div>
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-background/45 p-4">
              <p className="text-xs font-semibold text-muted-foreground">What changes</p>
              <p className="mt-2 text-sm text-foreground">Creator outreach threads route to your onboarded venue profile.</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/45 p-4">
              <p className="text-xs font-semibold text-muted-foreground">Approval model</p>
              <p className="mt-2 text-sm text-foreground">Nothing books, pays, or sends without organizer approval.</p>
            </div>
          </div>
        </section>
        <div>{children}</div>
      </div>
    </div>
  )
}

function ClaimShell({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
      <Card className="w-full rounded-md text-center">
        <CardContent className="py-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Venue claim</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-foreground">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{description}</p>
          <Button asChild className="mt-6" variant="default">
            <Link href="/">Back to 3rdPlace</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
