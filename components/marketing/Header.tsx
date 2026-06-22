'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

const navLinks = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Sign up', href: '/signup' },
  { label: 'Log in', href: '/login' },
]

export function Header() {
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsMobileOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function closeMenu() {
    setIsMobileOpen(false)
  }

  return (
    <header className="sticky top-0 z-50 border-b border-tan/70 bg-cream/90 backdrop-blur-md">
      <nav className="mx-auto flex h-[74px] max-w-[1480px] items-center justify-between px-5 sm:px-6 lg:px-8 2xl:px-10" aria-label="Primary navigation">
        <Link href="/" className="font-display text-[28px] font-semibold tracking-tight text-clay" onClick={closeMenu}>
          3rdPlace
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[16px] font-semibold text-ink-soft transition-colors hover:text-clay-deep hover:underline hover:decoration-clay hover:underline-offset-8"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-md bg-clay px-6 py-3 text-[16px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
          >
            Start running events
          </Link>
        </div>

        <button
          type="button"
          aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isMobileOpen}
          onClick={() => setIsMobileOpen((open) => !open)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream text-ink transition-colors hover:bg-cream-deep md:hidden"
        >
          {isMobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </nav>

      {isMobileOpen ? (
        <div className="fixed inset-0 z-[60] bg-cream px-5 py-5 md:hidden">
          <div className="flex items-center justify-between">
            <Link href="/" onClick={closeMenu} className="font-display text-[24px] font-semibold text-clay">
              3rdPlace
            </Link>
            <button
              type="button"
              onClick={closeMenu}
              className="rounded-md border border-tan bg-cream-deep px-3 py-2 text-sm font-semibold text-ink"
            >
              Close
            </button>
          </div>

          <nav className="mt-12 grid gap-3" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-md border border-tan bg-cream-deep px-4 py-4 text-[20px] font-semibold text-ink"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/planner"
              onClick={closeMenu}
              className="rounded-md bg-clay px-4 py-4 text-center text-[20px] font-semibold text-primary-foreground"
            >
              Start running events
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
