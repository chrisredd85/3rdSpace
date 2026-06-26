import { SignupExperience } from '@/components/auth/SignupExperience'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function hasSignupOverride(searchParams: Record<string, string | string[] | undefined>) {
  return searchParams.force === '1' || searchParams.switch_account === '1'
}

function readSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default async function SignupPage(
  props: {
    searchParams?: Promise<SearchParams>
  }
) {
  const searchParams = await props.searchParams;
  const resolvedSearchParams = searchParams ? await searchParams : {}

  return (
    <SignupExperience
      alreadySignedInWarning={hasSignupOverride(resolvedSearchParams)}
      opportunityToken={readSearchParam(resolvedSearchParams.opportunity_token)}
    />
  )
}
