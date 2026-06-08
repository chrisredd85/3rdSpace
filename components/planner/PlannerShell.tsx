/**
 * Purpose: Provides the light-mode planner product shell with collapsible side panels.
 * Props: Receives route children and renders them between the navigation sidebar and
 * Live Event Plan artifact panel.
 * Key behaviors: Scopes light design tokens to `/planner`, persists open/closed panel
 * state in localStorage, and uses width transitions so panels slide open and closed.
 */
'use client'

import { Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type UIEvent } from 'react'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface PlannerShellProps {
  children: ReactNode
}

const sidePanelOpenWidth = 264
const leftPanelCollapsedWidth = 72
const leftMinimumOpenWidth = 220
const mobilePromotedPlannerPaths = new Set([
  '/planner',
  '/planner/new-plan',
  '/planner/venues',
  '/planner/payments',
  '/planner/messages',
  '/planner/vendors',
  '/planner/analytics',
  '/planner/tickets',
  '/planner/billing',
  '/planner/settings',
])

const ActivePlanContextHeader = dynamic(
  () => import('@/components/planner/ActivePlanContextHeader').then((module) => module.ActivePlanContextHeader),
  { ssr: false }
)

const PlannerSidebar = dynamic(
  () => import('@/components/planner/PlannerSidebar').then((module) => module.PlannerSidebar),
  {
    ssr: false,
    loading: () => <div className="h-screen w-full border-r border-tan bg-cream" />,
  }
)

/**
 * Light planner shell with ChatGPT-style draggable side panels.
 */
export function PlannerShell({ children }: PlannerShellProps) {
  const pathname = usePathname()
  const [leftWidth, setLeftWidth] = useState(sidePanelOpenWidth)
  const [hasLoadedLeftWidth, setHasLoadedLeftWidth] = useState(false)
  const sideScrollRafRef = useRef<number | null>(null)
  const isLeftOpen = leftWidth >= leftMinimumOpenWidth
  const isLeftCollapsed = !isLeftOpen
  const isMobilePromotedPath = mobilePromotedPlannerPaths.has(pathname)

  useEffect(() => {
    const isNarrowViewport = window.innerWidth < 900
    const storedLeftWidth = window.localStorage.getItem('planner-left-panel-width')
    const left = storedLeftWidth === null ? null : Number(storedLeftWidth)
    if (isNarrowViewport) {
      setLeftWidth(leftPanelCollapsedWidth)
    } else if (typeof left === 'number' && Number.isFinite(left)) {
      setLeftWidth(snapLeftPanelWidth(left))
    }
    setHasLoadedLeftWidth(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedLeftWidth) return
    window.localStorage.setItem('planner-left-panel-width', String(leftWidth))
  }, [hasLoadedLeftWidth, leftWidth])

  useEffect(() => {
    return () => {
      if (sideScrollRafRef.current !== null) {
        window.cancelAnimationFrame(sideScrollRafRef.current)
      }
    }
  }, [])

  function syncSidePanelsToMainScroll(event: UIEvent<HTMLElement>) {
    const main = event.currentTarget
    const mainScrollableHeight = main.scrollHeight - main.clientHeight
    if (mainScrollableHeight <= 0) return

    const scrollRatio = main.scrollTop / mainScrollableHeight

    if (sideScrollRafRef.current !== null) {
      window.cancelAnimationFrame(sideScrollRafRef.current)
    }

    sideScrollRafRef.current = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-planner-side-scroll="true"]').forEach((panel) => {
        const panelScrollableHeight = panel.scrollHeight - panel.clientHeight
        if (panelScrollableHeight <= 0) return
        panel.scrollTop = Math.round(panelScrollableHeight * scrollRatio)
      })

      sideScrollRafRef.current = null
    })
  }

  function beginLeftDrag(event: PointerEvent<HTMLDivElement>) {
    const startX = event.clientX
    const startWidth = leftWidth

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      setLeftWidth(clampPanelWidth(startWidth + moveEvent.clientX - startX, sidePanelOpenWidth, leftPanelCollapsedWidth))
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      setLeftWidth((current) => snapLeftPanelWidth(current))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div
      className="planner-product-shell relative flex h-screen overflow-hidden bg-cream text-ink"
    >
      <div
        className={cn(
          'h-screen shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          isMobilePromotedPath && 'hidden lg:block'
        )}
        style={{ width: leftWidth }}
        aria-label={isLeftCollapsed ? 'Collapsed planner navigation' : 'Planner navigation'}
      >
        <div className="h-full w-full transition-transform duration-200 ease-out">
          <Suspense fallback={<div className="h-screen w-full border-r border-tan bg-cream" />}>
            <PlannerSidebar isCollapsed={isLeftCollapsed} />
          </Suspense>
        </div>
      </div>

      <PanelSlideHandle
        ariaLabel="Drag to resize navigation panel"
        side="left"
        isOpen={isLeftOpen}
        style={{ left: leftWidth }}
        onPointerDown={beginLeftDrag}
        className={isMobilePromotedPath ? 'hidden lg:block' : undefined}
      />

      <main className="min-w-0 flex-1 overflow-y-auto" onScroll={syncSidePanelsToMainScroll}>
        <div className={cn(isMobilePromotedPath && 'hidden lg:block')}>
          <ActivePlanContextHeader />
        </div>
        {children}
      </main>
    </div>
  )
}

function PanelSlideHandle({
  ariaLabel,
  side,
  isOpen,
  style,
  onPointerDown,
  className,
}: {
  ariaLabel: string
  side: 'left' | 'right'
  isOpen: boolean
  style: CSSProperties
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  className?: string
}) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuenow={isOpen ? 1 : 0}
      tabIndex={0}
      onPointerDown={onPointerDown}
      className={cn(
        'group fixed inset-y-0 z-50 w-3 cursor-col-resize touch-none transition-colors duration-150 hover:bg-clay-tint/60 active:bg-clay-tint',
        side === 'left' ? '-translate-x-1/2' : 'translate-x-1/2',
        className
      )}
      style={style}
    >
      <div
        className={cn(
          'absolute top-1/2 h-16 w-1 -translate-y-1/2 rounded-full bg-tan opacity-50 transition-colors duration-150 group-hover:bg-clay group-hover:opacity-100',
          side === 'left' ? 'left-1/2 -translate-x-1/2' : 'right-1/2 translate-x-1/2'
        )}
      />
      <span className="sr-only">{ariaLabel}</span>
    </div>
  )
}

function clampPanelWidth(width: number, maxWidth: number, collapsedWidth: number) {
  if (width < collapsedWidth) return collapsedWidth
  return Math.min(maxWidth, width)
}

function snapLeftPanelWidth(width: number) {
  return width < leftMinimumOpenWidth ? leftPanelCollapsedWidth : sidePanelOpenWidth
}
