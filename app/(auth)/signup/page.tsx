import { SignupExperience } from '@/components/auth/SignupExperience'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function hasSignupOverride(searchParams: Record<string, string | string[] | undefined>) {
  return searchParams.force === '1' || searchParams.switch_account === '1'
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: SearchParams
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}

  return <SignupExperience alreadySignedInWarning={hasSignupOverride(resolvedSearchParams)} />
}
