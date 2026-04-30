import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bell, CreditCard, DollarSign, MessageSquare, Package, Settings } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const settingsByRole = {
  builder: {
    title: 'Builder Settings',
    description: 'Manage event planning defaults, account access, billing, and notifications.',
    items: [
      {
        href: '/builder/billing',
        title: 'Billing',
        description: 'Review plan status, usage, invoices, and payment settings.',
        Icon: CreditCard,
      },
      {
        href: '/builder/notifications',
        title: 'Notifications',
        description: 'Control alerts for bookings, messages, payments, and reviews.',
        Icon: Bell,
      },
      {
        href: '/builder/messages',
        title: 'Messages',
        description: 'Open conversation threads with venues and vendors.',
        Icon: MessageSquare,
      },
    ],
  },
  vendor: {
    title: 'Vendor Settings',
    description: 'Manage pricing, packages, payout readiness, and notification preferences.',
    items: [
      {
        href: '/vendor/pricing',
        title: 'Pricing & Packages',
        description: 'Set hourly, flat, and per-head rates for booking requests.',
        Icon: DollarSign,
      },
      {
        href: '/vendor/payouts',
        title: 'Payouts',
        description: 'Review payout status and Stripe Connect account readiness.',
        Icon: Package,
      },
      {
        href: '/vendor/notifications',
        title: 'Notifications',
        description: 'Control alerts for booking requests, messages, payments, and reviews.',
        Icon: Bell,
      },
    ],
  },
} as const

type RoleSettingsPageProps = {
  params: {
    userType: string
  }
}

/**
 * Shared settings index for dashboard roles that do not have a dedicated settings hub.
 */
export default function RoleSettingsPage({ params }: RoleSettingsPageProps) {
  if (params.userType !== 'builder' && params.userType !== 'vendor') {
    notFound()
  }

  const settings = settingsByRole[params.userType]

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Settings className="h-5 w-5" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground">{settings.title}</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{settings.description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {settings.items.map(({ href, title, description, Icon }) => (
          <Link key={href} href={href}>
            <Card className="h-full border-border bg-gradient-card shadow-card transition-smooth hover:-translate-y-0.5 hover:border-primary/40">
              <CardHeader>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-xl text-foreground">{title}</CardTitle>
                <CardDescription className="text-muted-foreground">{description}</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-sm font-semibold text-primary">Open</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
