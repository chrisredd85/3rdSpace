import { notFound } from 'next/navigation'
import { SignupExperience } from '@/components/auth/SignupExperience'

type Portal = 'builder' | 'venue' | 'vendor'
type SearchParams = Record<string, string | string[] | undefined>

const allowedPortals = new Set<string>(['builder', 'venue', 'vendor'])

function hasSignupOverride(searchParams: Record<string, string | string[] | undefined>) {
  return searchParams.force === '1' || searchParams.switch_account === '1'
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * Renders the scoped signup flow for each portal.
 *
 * @param params - Dynamic signup portal route params.
 * @returns Builder signup experience or a static supply-side early-access page.
 */
export default async function ScopedSignupPage(
  props: {
    params: Promise<{ portal: string }>
    searchParams?: Promise<SearchParams>
  }
) {
  const { portal } = await props.params
  const resolvedSearchParams = props.searchParams ? await props.searchParams : {}

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
        opportunityToken={readSearchParam(resolvedSearchParams.opportunity_token)}
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
