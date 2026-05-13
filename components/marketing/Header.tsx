'use client'

import { useEffect, useRef, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, ChevronDown, Menu, Sparkles, Store, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const centerLinks = [
  { label: "Who it's for", href: '#who' },
  { label: 'Features', href: '#features' },
]

const supplyLinks = [
  { label: 'List your venue', href: '/signup/venue', icon: Building2 },
  { label: 'List as vendor', href: '/signup/vendor', icon: Store },
]

type MarketingNavLink = {
  label: string
  href: string
  icon?: ComponentType<{ className?: string }>
}

const mobileLinks: MarketingNavLink[] = [
  ...centerLinks,
  ...supplyLinks,
  { label: 'Sign in', href: '/login' },
]

export function Header() {
  const [isSupplyOpen, setIsSupplyOpen] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const supplyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!supplyRef.current?.contains(event.target as Node)) {
        setIsSupplyOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsSupplyOpen(false)
        setIsMobileOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function closeMenus() {
    setIsSupplyOpen(false)
    setIsMobileOpen(false)
  }

  return (
    <header className="absolute inset-x-0 top-0 z-50 px-4 py-4 sm:px-6 lg:px-12">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3" aria-label="Primary navigation">
        <Link
          href="/"
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-xl transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          onClick={closeMenus}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">3rdPlace</span>
        </Link>

        <div className="hidden items-center gap-8 text-sm md:flex">
          {centerLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg text-muted-foreground transition-smooth hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div ref={supplyRef} className="relative hidden md:block">
            <Button
              variant="glass"
              size="sm"
              type="button"
              aria-expanded={isSupplyOpen}
              aria-haspopup="menu"
              onClick={() => setIsSupplyOpen((open) => !open)}
              className="focus-visible:ring-primary/30"
            >
              <Building2 className="h-4 w-4" />
              List with us
              <ChevronDown className={cn('h-4 w-4 transition-smooth', isSupplyOpen && 'rotate-180')} />
            </Button>

            {isSupplyOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-3 w-56 overflow-hidden rounded-2xl border border-border bg-gradient-card p-2 shadow-card"
              >
                {supplyLinks.map(({ label, href, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    role="menuitem"
                    onClick={closeMenus}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground transition-smooth hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    {label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link
            href="/login"
            className="hidden rounded-lg px-2 py-2 text-sm font-medium text-muted-foreground transition-smooth hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:inline-flex"
            onClick={closeMenus}
          >
            Sign in
          </Link>

          <button
            type="button"
            aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileOpen}
            onClick={() => setIsMobileOpen((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/60 text-foreground transition-smooth hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:hidden"
          >
            {isMobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <Button variant="hero" size="sm" asChild className="px-3 sm:px-4">
            <Link href="/planner" onClick={closeMenus}>
              <span className="hidden sm:inline">Start planning</span>
              <span className="sm:hidden">Start</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </nav>

      {isMobileOpen && (
        <div role="menu" className="mt-3 rounded-2xl border border-border bg-gradient-card p-2 shadow-card md:hidden">
          {mobileLinks.map((link) => {
            const Icon = link.icon
            return (
              <a
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={closeMenus}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-foreground transition-smooth hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
                {link.label}
              </a>
            )
          })}
        </div>
      )}
    </header>
  )
}
