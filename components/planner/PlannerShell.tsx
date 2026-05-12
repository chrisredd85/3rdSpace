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
const rightPanelMaxWidth = 460
const leftPanelCollapsedWidth = 72
const leftMinimumOpenWidth = 220
const rightMinimumOpenWidth = 220

const ActivePlanContextHeader = dynamic(
  () => import('@/components/planner/ActivePlanContextHeader').then((module) => module.ActivePlanContextHeader),
  { ssr: false }
)

const PlannerSidebar = dynamic(
  () => import('@/components/planner/PlannerSidebar').then((module) => module.PlannerSidebar),
  {
    ssr: false,
    loading: () => <div className="h-screen w-full border-r border-sidebar-border bg-sidebar" />,
  }
)

const PlannerLivePlanPanel = dynamic(
  () => import('@/components/planner/PlannerLivePlanPanel').then((module) => module.PlannerLivePlanPanel),
  {
    ssr: false,
    loading: () => <div className="h-full w-full border-l border-border bg-card" />,
  }
)

/**
 * Light planner shell with ChatGPT-style draggable side panels.
 */
export function PlannerShell({ children }: PlannerShellProps) {
  const pathname = usePathname()
  const [leftWidth, setLeftWidth] = useState(sidePanelOpenWidth)
  const [rightWidth, setRightWidth] = useState(sidePanelOpenWidth)
  const [hasLoadedPanelWidths, setHasLoadedPanelWidths] = useState(false)
  const sideScrollRafRef = useRef<number | null>(null)
  const isLeftOpen = leftWidth >= leftMinimumOpenWidth
  const isLeftCollapsed = !isLeftOpen
  const isRightOpen = rightWidth > 0
  const shouldHideRightPanelOnCompactRoutes = pathname !== '/planner'

  useEffect(() => {
    const isNarrowViewport = window.innerWidth < 900
    const left = Number(window.localStorage.getItem('planner-left-panel-width'))
    const right = Number(window.localStorage.getItem('planner-right-panel-width'))
    if (isNarrowViewport) {
      setLeftWidth(leftPanelCollapsedWidth)
      setRightWidth(0)
    } else {
      if (Number.isFinite(left)) setLeftWidth(snapLeftPanelWidth(left))
      if (Number.isFinite(right)) setRightWidth(snapRightPanelWidth(right))
    }
    setHasLoadedPanelWidths(true)
  }, [])

  useEffect(() => {
    if (!hasLoadedPanelWidths) return
    window.localStorage.setItem('planner-left-panel-width', String(leftWidth))
  }, [hasLoadedPanelWidths, leftWidth])

  useEffect(() => {
    if (!hasLoadedPanelWidths) return
    window.localStorage.setItem('planner-right-panel-width', String(rightWidth))
  }, [hasLoadedPanelWidths, rightWidth])

  useEffect(() => {
    if (!hasLoadedPanelWidths || window.innerWidth >= 900 || pathname === '/planner') return
    setRightWidth(0)
  }, [hasLoadedPanelWidths, pathname])

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

  function beginRightDrag(event: PointerEvent<HTMLDivElement>) {
    const startX = event.clientX
    const startWidth = rightWidth

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      setRightWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX, rightPanelMaxWidth, 0))
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      setRightWidth((current) => snapRightPanelWidth(current))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div
      className="planner-product-shell relative flex min-h-screen overflow-hidden bg-background text-foreground"
    >
      <div
        className="h-screen shrink-0 overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: leftWidth }}
        aria-label={isLeftCollapsed ? 'Collapsed planner navigation' : 'Planner navigation'}
      >
        <div className="h-full w-full transition-transform duration-200 ease-out">
          <Suspense fallback={<div className="h-screen w-full border-r border-sidebar-border bg-sidebar" />}>
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
      />

      <main className="min-w-0 flex-1 overflow-y-auto" onScroll={syncSidePanelsToMainScroll}>
        <ActivePlanContextHeader />
        {children}
      </main>

      <div
        className={cn(
          'fixed inset-y-0 right-0 z-40 h-screen shrink-0 overflow-hidden transition-[width,transform] duration-200 ease-out xl:relative xl:z-auto',
          shouldHideRightPanelOnCompactRoutes && 'hidden lg:block',
          isRightOpen
            ? 'translate-x-0'
            : 'w-screen max-w-[264px] translate-x-full xl:w-0 xl:max-w-none xl:translate-x-0'
        )}
        style={isRightOpen ? { width: `min(${rightWidth}px, 100vw)`, maxWidth: '100vw' } : undefined}
        aria-hidden={!isRightOpen}
      >
        <div
          className={cn(
            'h-full w-full max-w-full transition-transform duration-200 ease-out',
            isRightOpen ? 'translate-x-0' : 'translate-x-full'
          )}
        >
          <Suspense fallback={<div className="h-full w-full border-l border-border bg-card" />}>
            <PlannerLivePlanPanel />
          </Suspense>
        </div>
      </div>

      <PanelSlideHandle
        ariaLabel="Drag to resize live plan panel"
        side="right"
        isOpen={isRightOpen}
        style={{ right: rightWidth }}
        onPointerDown={beginRightDrag}
        className={shouldHideRightPanelOnCompactRoutes ? 'hidden lg:block' : undefined}
      />
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
        'group fixed inset-y-0 z-50 w-3 cursor-col-resize touch-none transition-colors duration-150 hover:bg-secondary/10 active:bg-secondary/20',
        side === 'left' ? '-translate-x-1/2' : 'translate-x-1/2',
        className
      )}
      style={style}
    >
      <div
        className={cn(
          'absolute top-1/2 h-16 w-1 -translate-y-1/2 rounded-full bg-border opacity-40 transition-opacity duration-150 group-hover:opacity-100',
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

function snapRightPanelWidth(width: number) {
  if (width < rightMinimumOpenWidth) return 0
  return Math.max(sidePanelOpenWidth, Math.min(rightPanelMaxWidth, width))
}
