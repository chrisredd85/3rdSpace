import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const settings = [
  { href: '/venue/settings/rules', title: 'House Rules', description: 'Rules, insurance requirements, safety, and conduct.' },
  { href: '/venue/settings/amenities', title: 'Amenities', description: 'Standard and custom venue amenities.' },
  { href: '/venue/settings/deposits', title: 'Deposits', description: 'Fixed or percentage deposit requirements.' },
  { href: '/venue/settings/bulk-approval', title: 'Bulk Approval', description: 'Batch approval and auto-approval rules.' },
  { href: '/venue/settings/unique-features', title: 'Unique Features', description: 'Standout venue description and searchable tags.' },
]

/**
 * Lists venue owner feature settings pages.
 *
 * @returns Venue settings index page.
 */
export default function VenueSettingsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Venue Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage the venue owner features used in booking flows.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {settings.map((setting) => (
          <Link key={setting.href} href={setting.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>{setting.title}</CardTitle>
                <CardDescription>{setting.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-semibold text-primary">Open settings</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

