import { notFound } from 'next/navigation'
import { SignupExperience } from '@/components/auth/SignupExperience'
import { VenueListingInfoPage } from '@/components/auth/VenueListingInfoPage'
import { VendorListingInfoPage } from '@/components/auth/VendorListingInfoPage'

type Portal = 'builder' | 'venue' | 'vendor'
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const allowedPortals = new Set<string>(['builder', 'venue', 'vendor'])

function hasSignupOverride(searchParams: Record<string, string | string[] | undefined>) {
  return searchParams.force === '1' || searchParams.switch_account === '1'
}

/**
 * Renders builder signup while replacing venue/vendor self-signup with catalog info pages.
 *
 * @param params - Dynamic signup portal route params.
 * @returns Builder signup experience or a static supply-side early-access page.
 */
export default async function ScopedSignupPage({
  params,
  searchParams,
}: {
  params: Promise<{ portal: string }>
  searchParams?: SearchParams
}) {
  const { portal } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}

  if (!allowedPortals.has(portal)) {
    notFound()
  }

  if (portal === 'builder') {
    return (
      <SignupExperience
        initialUserType="community_builder"
        alreadySignedInWarning={hasSignupOverride(resolvedSearchParams)}
      />
    )
  }

  if (portal === 'venue') {
    return <VenueListingInfoPage />
  }

  return <VendorListingInfoPage />
}
