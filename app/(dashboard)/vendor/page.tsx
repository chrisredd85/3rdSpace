'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, TrendingUp, Calendar, PiggyBank, FileText, Send, ArrowRight, Music2, DollarSign, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PayoutOverviewPanel } from '@/components/dashboard/PayoutOverviewPanel'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'

interface VendorStats {
  vendorId?: string
  isPublished?: boolean
  newRequests: number
  confirmedGigs: number
  revenueMtd: number
  revenueChange?: number
  responseRate: number
}

function formatMoney(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string
  value: string
  hint?: string
  icon: React.ReactNode
  accent: 'success' | 'primary' | 'accent' | 'secondary'
}) {
  const accentBg = {
    success: 'bg-success/15 text-success',
    primary: 'bg-primary/15 text-primary',
    accent: 'bg-accent/15 text-accent-foreground',
    secondary: 'bg-secondary/15 text-secondary',
  }
  return (
    <div className="rounded-3xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={`rounded-xl p-2.5 ${accentBg[accent]}`}>{icon}</div>
      </div>
    </div>
  )
}

export default function VendorDashboard() {
  const { user } = useUser()
  const { addToast } = useToast()
  const [stats, setStats] = useState<VendorStats | null>(null)
  const [pendingRequests, setPendingRequests] = useState<any[]>([])
  const [hasStripeAccount, setHasStripeAccount] = useState<boolean | null>(null)
  const [isStripeBannerDismissed, setIsStripeBannerDismissed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      fetch('/api/vendor/stats', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
      fetch('/api/vendor/bookings?status=pending&limit=5', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
      fetch('/api/vendor/stripe/status', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([statsData, bookingsData, stripeData]) => {
        if (statsData) setStats(statsData)
        if (bookingsData) setPendingRequests(bookingsData.bookings || [])
        if (stripeData) setHasStripeAccount(Boolean(stripeData.account?.stripe_account_id))
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [user])

  const handleSendQuote = async (bookingId: string) => {
    addToast({ title: 'Quote sent!', description: 'The event creator will respond shortly.' })
  }

  const bookingPath = stats?.vendorId ? `/planner/vendors/${stats.vendorId}?source=vendor_share` : null
  const bookingUrl = bookingPath && typeof window !== 'undefined' ? `${window.location.origin}${bookingPath}` : bookingPath

  const handleCopyBookingLink = async () => {
    if (!bookingUrl) return

    try {
      await navigator.clipboard.writeText(bookingUrl)
      addToast({
        title: 'Booking link copied',
        description: 'Share this with hosts so they can request your services in their planner.',
      })
    } catch {
      addToast({
        title: 'Could not copy link',
        description: bookingUrl,
        variant: 'destructive',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">Welcome back</p>
        <h1 className="mt-1 font-display text-4xl font-bold">Your Vendor Dashboard</h1>
      </div>

      {!isStripeBannerDismissed && hasStripeAccount === false ? (
        <div className="rounded-3xl border border-primary/30 bg-primary/10 p-5 shadow-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="font-display text-lg font-bold">Connect Stripe to receive deposits when you accept an opportunity</p>
                <p className="mt-1 text-sm text-muted-foreground">You can explore requests before setup. Payouts are only required when money needs to move.</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="hero" size="sm" asChild>
                <Link href="/vendor/payouts">Set up payouts</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsStripeBannerDismissed(true)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {bookingPath && bookingUrl ? (
        <div className="rounded-3xl border border-border bg-gradient-card p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Public booking link</p>
              <h2 className="mt-1 font-display text-xl font-bold">Let hosts book you through 3rdPlace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Share this link on your site, Instagram bio, or with event hosts. It starts a planner request with your vendor profile attached.
              </p>
              {stats?.isPublished === false ? (
                <p className="mt-2 text-sm font-medium text-secondary">
                  Your profile is unpublished. Publish your services before sharing this link broadly.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Hosts still approve every booking, quote, deposit, and outreach step before anything is executed.
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2 lg:w-[420px]">
              <code className="truncate rounded-2xl border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
                {bookingUrl}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="hero" size="sm" onClick={handleCopyBookingLink}>
                  <Copy className="h-4 w-4" />
                  Copy link
                </Button>
                {stats?.isPublished === false ? (
                  <Button variant="glass" size="sm" asChild>
                    <Link href="/vendor/services">Publish profile</Link>
                  </Button>
                ) : (
                  <Button variant="glass" size="sm" asChild>
                    <Link href={bookingPath}>
                      <ExternalLink className="h-4 w-4" />
                      Open
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Confirmed Revenue"
          value={formatMoney(stats?.revenueMtd ?? 0)}
          hint="Booked gigs"
          icon={<TrendingUp className="h-5 w-5" />}
          accent="success"
        />
        <StatCard
          label="Pending Quotes"
          value={String(stats?.newRequests ?? 0)}
          hint="Awaiting response"
          icon={<FileText className="h-5 w-5" />}
          accent="primary"
        />
        <StatCard
          label="Active Gigs"
          value={String(stats?.confirmedGigs ?? 0)}
          hint="This month"
          icon={<Calendar className="h-5 w-5" />}
          accent="accent"
        />
        <StatCard
          label="Response Rate"
          value={`${stats?.responseRate ?? 0}%`}
          icon={<PiggyBank className="h-5 w-5" />}
          accent="secondary"
        />
      </div>

      <PayoutOverviewPanel role="vendor" />

      {/* Incoming requests */}
      <div className="rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Incoming requests</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/vendor/bookings">View all <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>

        {pendingRequests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40" />
            <p className="mt-3 font-display font-semibold">No pending requests</p>
            <p className="mt-1 text-sm text-muted-foreground">New booking requests will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingRequests.map((b: any) => {
              const event = b.events as any
              return (
                <div key={b.id} className="rounded-2xl border border-border bg-card/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-display font-semibold">{event?.title || 'Event Booking Request'}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.confirmed_date || b.requested_date
                          ? new Date(b.confirmed_date || b.requested_date).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                            })
                          : 'Date TBD'}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="rounded-full bg-secondary/15 px-2.5 py-0.5 text-xs font-semibold text-secondary">
                          {b.status || 'pending'}
                        </span>
                        {(b.final_price || b.quoted_price) && (
                          <span className="text-sm font-semibold">
                            {formatMoney(b.final_price || b.quoted_price)}
                          </span>
                        )}
                      </div>
                    </div>
                    {(b.status === 'pending' || b.status === 'requested' || b.status === 'quoted') && (
                      <Button variant="hero" size="sm" onClick={() => handleSendQuote(b.id)}>
                        <Send className="h-4 w-4" /> Send quote
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'View Calendar', hint: 'Manage availability', href: '/vendor/calendar', icon: Calendar },
          { label: 'Update Services', hint: 'Edit offerings & packages', href: '/vendor/services', icon: Music2 },
          { label: 'Adjust Pricing', hint: 'Update rates & deposits', href: '/vendor/pricing', icon: DollarSign },
        ].map((a) => {
          const Icon = a.icon
          return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-start gap-4 rounded-3xl border border-border bg-gradient-card p-5 shadow-card transition-smooth hover:-translate-y-1 hover:shadow-glow"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display font-semibold">{a.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.hint}</p>
            </div>
          </Link>
          )
        })}
      </div>
    </div>
  )
}
