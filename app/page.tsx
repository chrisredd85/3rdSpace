import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Home',
  description: "Bay Area's leading B2B event marketplace connecting community builders, venue owners, and vendors.",
  openGraph: {
    title: '3rdSpace - B2B Event Marketplace',
    description: "Bay Area's leading B2B event marketplace connecting community builders, venue owners, and vendors.",
  },
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-24">
      <main className="flex flex-col items-center gap-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-md bg-forest-500 text-white text-4xl font-bold">
          3
        </div>
        <h1 className="text-4xl font-bold text-gray-900">Welcome to 3rdSpace</h1>
        <p className="text-xl text-gray-600 text-center max-w-2xl">
          Bay Area&apos;s leading B2B event marketplace connecting community builders, venue owners, and vendors.
        </p>
        <div className="flex gap-4">
          <Link href="/login">
            <Button size="lg">Get Started</Button>
          </Link>
          <Link href="/signup">
            <Button variant="outline" size="lg">Sign Up</Button>
          </Link>
        </div>
      </main>
    </div>
  )
}
