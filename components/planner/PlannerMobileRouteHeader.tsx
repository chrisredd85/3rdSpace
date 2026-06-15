'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type PlannerMobileRouteHeaderProps = {
  actionHref?: string
  actionLabel?: string
  activeHref?: string
  panelTitle?: string
}

const navLinks = [
  { label: 'Agent Planner', href: '/planner' },
  { label: 'Experiences', href: '/planner/experiences' },
  { label: 'Templates', href: '/planner/templates' },
  { label: 'Venues', href: '/planner/venues' },
  { label: 'Tickets', href: '/planner/tickets' },
  { label: 'Vendors', href: '/planner/vendors' },
  { label: 'Outreach', href: '/planner/outreach' },
  { label: 'Messages', href: '/planner/messages' },
  { label: 'Payments', href: '/planner/payments' },
  { label: 'Billing', href: '/planner/billing' },
  { label: 'Analytics', href: '/planner/analytics' },
  { label: 'Settings', href: '/planner/settings' },
]

export function PlannerMobileRouteHeader({
  actionHref = '/planner?view=approval',
  actionLabel = 'Next step',
  activeHref = '/planner',
  panelTitle = 'Plan workspace',
}: PlannerMobileRouteHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-tan bg-cream/95 px-5 pb-4 pt-4 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <Link href="/planner" className="font-display text-[28px] font-semibold text-clay-deep">
            3rdPlace
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={actionHref}
              className="inline-flex h-10 items-center rounded-full border border-tan bg-cream-deep px-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-ink-soft"
            >
              {actionLabel}
            </Link>
            <button
              type="button"
              onClick={() => setIsMenuOpen((current) => !current)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-tan bg-cream-deep text-ink"
              aria-label={isMenuOpen ? 'Close navigation' : 'Open navigation'}
            >
              {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-30 overflow-hidden bg-ink/20 lg:hidden" onClick={() => setIsMenuOpen(false)}>
          <div
            className="ml-auto flex h-[100dvh] max-h-[100dvh] w-[86%] max-w-[360px] flex-col overflow-y-auto overscroll-contain border-l border-tan bg-cream pb-[calc(env(safe-area-inset-bottom)_+_2rem)] pt-20 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5">
              <p className="label-caps text-clay">{panelTitle}</p>
              <p className="mt-2 truncate font-display text-[26px] leading-tight text-ink">3rdPlace planner</p>
            </div>
            <nav className="mt-6 border-y border-tan" aria-label="Mobile planner navigation">
              {navLinks.map((link) => {
                const isActive = link.href === '/planner'
                  ? activeHref === link.href
                  : activeHref === link.href || activeHref.startsWith(`${link.href}/`)

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={cn(
                      'flex items-center justify-between border-b border-tan px-5 py-4 text-[15px] font-semibold last:border-b-0',
                      isActive ? 'bg-clay-tint text-clay-deep' : 'text-ink-soft'
                    )}
                  >
                    {link.label}
                    {isActive ? <span className="h-2 w-2 rounded-full bg-clay" aria-hidden /> : null}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  )
}
