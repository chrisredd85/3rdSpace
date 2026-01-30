import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Manage your events, find venues and vendors, and track your event planning progress.',
  openGraph: {
    title: 'Community Builder Dashboard | 3rdSpace',
    description: 'Manage your events, find venues and vendors, and track your event planning progress.',
  },
}

export default function BuilderLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
