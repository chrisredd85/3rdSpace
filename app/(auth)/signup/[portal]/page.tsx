import { notFound } from 'next/navigation'
import { SignupExperience } from '@/components/auth/SignupExperience'
import { VenueListingInfoPage } from '@/components/auth/VenueListingInfoPage'
import { VendorListingInfoPage } from '@/components/auth/VendorListingInfoPage'

type Portal = 'builder' | 'venue' | 'vendor'

const allowedPortals = new Set<string>(['builder', 'venue', 'vendor'])

/**
 * Renders builder signup while replacing venue/vendor self-signup with catalog info pages.
 *
 * @param params - Dynamic signup portal route params.
 * @returns Builder signup experience or a static supply-side early-access page.
 */
export default async function ScopedSignupPage({
  params,
}: {
  params: Promise<{ portal: string }>
}) {
  const { portal } = await params

  if (!allowedPortals.has(portal)) {
    notFound()
  }

  if (portal === 'builder') {
    return <SignupExperience initialUserType="community_builder" />
  }

  if (portal === 'venue') {
    return <VenueListingInfoPage />
  }

  return <VendorListingInfoPage />
}
