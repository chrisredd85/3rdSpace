import { notFound } from 'next/navigation'
import { AccountSettingsClient } from '@/components/settings/AccountSettingsClient'

type RoleSettingsPageProps = {
  params: Promise<{
    userType: string
  }>
}

/**
 * Shared account settings for builder and vendor dashboard roles.
 */
export default async function RoleSettingsPage({ params }: RoleSettingsPageProps) {
  const { userType } = await params
  if (userType !== 'builder' && userType !== 'vendor') {
    notFound()
  }

  return <AccountSettingsClient role={userType} />
}
