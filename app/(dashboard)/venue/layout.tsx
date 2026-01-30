import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Venue Dashboard',
  description: 'Manage your venue listings, booking requests, calendar, and pricing.',
  openGraph: {
    title: 'Venue Owner Dashboard | 3rdSpace',
    description: 'Manage your venue listings, booking requests, calendar, and pricing.',
  },
}

export default function VenueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
