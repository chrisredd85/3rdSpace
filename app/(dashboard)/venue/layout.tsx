import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Venue Dashboard',
  description: 'Run your venue listings, booking requests, calendar, and pricing.',
  openGraph: {
    title: 'Venue Owner Dashboard | 3rdPlace',
    description: 'Run your venue listings, booking requests, calendar, and pricing.',
  },
}

export default function VenueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
