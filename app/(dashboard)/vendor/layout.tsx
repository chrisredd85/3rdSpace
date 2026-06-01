import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Vendor Dashboard',
  description: 'Run your service listings, booking requests, calendar, and pricing packages.',
  openGraph: {
    title: 'Vendor Dashboard | 3rdPlace',
    description: 'Run your service listings, booking requests, calendar, and pricing packages.',
  },
}

export default function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
