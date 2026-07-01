'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'cookie_consent_v1'

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY)) return
    setVisible(true)
  }, [])

  function recordConsent(value: 'accepted' | 'rejected') {
    window.localStorage.setItem(STORAGE_KEY, value)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-40 rounded-md border border-tan bg-cream px-3 py-2 shadow-[0_-10px_30px_rgba(40,30,20,0.08)] sm:inset-x-0 sm:bottom-0 sm:top-auto sm:rounded-none sm:border-x-0 sm:border-b-0 sm:px-5 sm:py-4"
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-2 sm:gap-3">
        <p className="max-w-3xl text-[12px] leading-5 text-ink-soft sm:text-[14px] sm:leading-6">
          We use cookies to improve your experience, remember choices, and keep 3rdPlace reliable. By continuing,
          you accept our{' '}
          <Link href="/privacy" className="font-semibold text-clay underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/privacy#cookies-and-tracking"
            className="hidden min-h-9 items-center rounded-md border border-tan bg-cream px-3 text-[13px] font-semibold text-ink transition-colors hover:border-clay sm:inline-flex sm:min-h-10 sm:px-4"
          >
            Manage preferences
          </Link>
          <button
            type="button"
            onClick={() => recordConsent('rejected')}
            className="hidden min-h-9 items-center rounded-md border border-tan bg-cream px-3 text-[13px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-ink sm:inline-flex sm:min-h-10 sm:px-4"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => recordConsent('accepted')}
            className="inline-flex min-h-9 items-center rounded-md bg-clay px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep sm:min-h-10 sm:px-4"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
