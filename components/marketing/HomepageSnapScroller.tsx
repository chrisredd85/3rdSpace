'use client'

import type { KeyboardEvent, ReactNode } from 'react'

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'])

function shouldIgnoreKeyboardScroll(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(target.closest('a, button, input, textarea, select, [contenteditable="true"]'))
}

export function HomepageSnapScroller({ children }: { children: ReactNode }) {
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!SCROLL_KEYS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
    if (shouldIgnoreKeyboardScroll(event.target)) return

    const scroller = event.currentTarget
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'

    event.preventDefault()

    if (event.key === 'Home') {
      scroller.scrollTo({ top: 0, behavior })
      return
    }

    if (event.key === 'End') {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior })
      return
    }

    const direction =
      event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)
        ? -1
        : 1

    scroller.scrollBy({ top: direction * scroller.clientHeight, behavior })
  }

  return (
    <main
      tabIndex={0}
      aria-label="3rdPlace homepage sections"
      onKeyDown={handleKeyDown}
      className="homepage-scroll-snap h-[calc(100dvh-74px)] overflow-y-scroll snap-y snap-mandatory bg-background text-foreground focus:outline-none"
    >
      {children}
    </main>
  )
}
