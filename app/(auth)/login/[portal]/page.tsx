import { notFound } from 'next/navigation'
import { RoleLoginPage } from '@/components/auth/RoleLoginPage'

type Portal = 'builder' | 'venue' | 'vendor'

const validPortals: Portal[] = ['builder', 'venue', 'vendor']

export default async function ScopedLoginPage({
  params,
}: {
  params: Promise<{ portal: string }>
}) {
  const { portal } = await params

  if (!validPortals.includes(portal as Portal)) {
    notFound()
  }

  return <RoleLoginPage portal={portal as Portal} />
}
