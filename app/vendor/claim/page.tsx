import Link from 'next/link'
import { VendorClaimFlow } from '@/components/vendor/VendorClaimFlow'
import { Button } from '@/components/ui/button'
import { getVendorClaimDetails } from '@/lib/vendors/vendorClaims'

export const dynamic = 'force-dynamic'

export default async function VendorClaimPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const token = searchParams.token
  if (!token) {
    return <ClaimError message="Missing vendor invite token." />
  }

  const result = await getVendorClaimDetails(token)
  if (!result.ok) {
    return <ClaimError message={result.error} />
  }

  if (result.details.claim_status === 'invited_claimed') {
    return <ClaimError message="This vendor invite has already been claimed. Sign in to manage your profile." />
  }

  return <VendorClaimFlow token={token} details={result.details} />
}

function ClaimError({ message }: { message: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-12">
      <div className="w-full rounded-3xl border border-border bg-gradient-card p-6 text-center shadow-card">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Vendor invite</p>
        <h1 className="mt-3 font-display text-3xl font-bold text-foreground">Invite unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <Button asChild className="mt-6" variant="hero">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </div>
  )
}
