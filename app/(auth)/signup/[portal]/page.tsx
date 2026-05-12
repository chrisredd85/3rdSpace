import { notFound } from 'next/navigation'
import { SignupExperience } from '@/components/auth/SignupExperience'

type Portal = 'builder' | 'venue' | 'vendor'
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const allowedPortals = new Set<string>(['builder', 'venue', 'vendor'])

function hasSignupOverride(searchParams: Record<string, string | string[] | undefined>) {
  return searchParams.force === '1' || searchParams.switch_account === '1'
}

/**
 * Renders the scoped signup flow for each portal.
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
    return (
      <SignupExperience
        initialUserType="venue_owner"
        alreadySignedInWarning={hasSignupOverride(resolvedSearchParams)}
      />
    )
  }

  return (
    <SignupExperience
      initialUserType="vendor"
      alreadySignedInWarning={hasSignupOverride(resolvedSearchParams)}
    />
  )
}
