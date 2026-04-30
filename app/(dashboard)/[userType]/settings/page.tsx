import { notFound } from 'next/navigation'
import { AccountSettingsClient } from '@/components/settings/AccountSettingsClient'

type RoleSettingsPageProps = {
  params: {
    userType: string
  }
}

/**
 * Shared account settings for builder and vendor dashboard roles.
 */
export default function RoleSettingsPage({ params }: RoleSettingsPageProps) {
  if (params.userType !== 'builder' && params.userType !== 'vendor') {
    notFound()
  }

  return <AccountSettingsClient role={params.userType} />
}
