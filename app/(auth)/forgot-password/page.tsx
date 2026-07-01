import { Suspense } from 'react'
import { ForgotPasswordPage } from '@/components/auth/ForgotPasswordPage'

type ForgotPasswordRouteProps = {
  searchParams?: Promise<{ portal?: string }>
}

export default async function ForgotPasswordRoute({ searchParams }: ForgotPasswordRouteProps) {
  const resolvedSearchParams = await searchParams

  return (
    <Suspense fallback={null}>
      <ForgotPasswordPage portal={resolvedSearchParams?.portal ?? null} />
    </Suspense>
  )
}
