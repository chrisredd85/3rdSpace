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
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-tan bg-cream px-5 py-4 shadow-[0_-10px_30px_rgba(40,30,20,0.08)]">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-[14px] leading-6 text-ink-soft">
          We use cookies to improve your experience, remember choices, and keep 3rdPlace reliable. By continuing,
          you accept our{' '}
          <Link href="/privacy" className="font-semibold text-clay underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/privacy#cookies-and-tracking"
            className="inline-flex min-h-10 items-center rounded-md border border-tan bg-cream px-4 text-[13px] font-semibold text-ink transition-colors hover:border-clay"
          >
            Manage preferences
          </Link>
          <button
            type="button"
            onClick={() => recordConsent('rejected')}
            className="inline-flex min-h-10 items-center rounded-md border border-tan bg-cream px-4 text-[13px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-ink"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => recordConsent('accepted')}
            className="inline-flex min-h-10 items-center rounded-md bg-clay px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

