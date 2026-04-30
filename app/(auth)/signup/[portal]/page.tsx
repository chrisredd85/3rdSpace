import { notFound } from 'next/navigation'
import { SignupExperience } from '@/components/auth/SignupExperience'
import type { UserType } from '@/lib/types'

type Portal = 'builder' | 'venue' | 'vendor'

const portalToUserType: Record<Portal, UserType> = {
  builder: 'community_builder',
  venue: 'venue_owner',
  vendor: 'vendor',
}

export default async function ScopedSignupPage({
  params,
}: {
  params: Promise<{ portal: string }>
}) {
  const { portal } = await params

  if (!(portal in portalToUserType)) {
    notFound()
  }

  return <SignupExperience initialUserType={portalToUserType[portal as Portal]} />
}
