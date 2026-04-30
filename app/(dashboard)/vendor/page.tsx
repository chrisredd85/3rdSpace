'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { TrendingUp, Calendar, PiggyBank, FileText, Send, ArrowRight, Music2, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUser } from '@/lib/hooks/useUser'
import { useToast } from '@/components/ui/toast'

interface VendorStats {
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
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      fetch('/api/vendor/stats', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
      fetch('/api/vendor/bookings?status=pending&limit=5', { credentials: 'include' }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([statsData, bookingsData]) => {
        if (statsData) setStats(statsData)
        if (bookingsData) setPendingRequests(bookingsData.bookings || [])
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [user])

  const handleSendQuote = async (bookingId: string) => {
    addToast({ title: 'Quote sent!', description: 'The event creator will respond shortly.' })
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
