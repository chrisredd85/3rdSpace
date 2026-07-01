'use client'

import { usePathname } from 'next/navigation'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { MobilePlanner, type MobileSection, type MobileView } from '@/components/planner/mobile/MobilePlanner'

type MobileRouteConfig = {
  activeSection: MobileSection
  initialView?: MobileView
}

const mobileRouteMap: Record<string, MobileRouteConfig> = {
  '/planner': { activeSection: 'planner' },
  '/planner/new-plan': { activeSection: 'planner', initialView: 'new-plan' },
  '/planner/venues': { activeSection: 'planner', initialView: 'venues' },
  '/planner/approvals': { activeSection: 'approvals' },
  '/planner/payments': { activeSection: 'approvals' },
  '/planner/messages': { activeSection: 'messages' },
  '/planner/outreach': { activeSection: 'outreach' },
  '/planner/vendors': { activeSection: 'vendors' },
  '/planner/analytics': { activeSection: 'analytics' },
  '/planner/tickets': { activeSection: 'ticketing' },
  '/planner/billing': { activeSection: 'billing' },
  '/planner/settings': { activeSection: 'settings' },
}

export function PlannerResponsiveLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const mobileConfig = mobileRouteMap[pathname]
  const [shouldMountMobile, setShouldMountMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)')
    const updateShouldMountMobile = () => setShouldMountMobile(mediaQuery.matches)

    updateShouldMountMobile()
    mediaQuery.addEventListener('change', updateShouldMountMobile)
    return () => mediaQuery.removeEventListener('change', updateShouldMountMobile)
  }, [])

  if (!mobileConfig) return <>{children}</>

  return (
    <>
      <div className="lg:hidden">
        {shouldMountMobile ? (
          <Suspense fallback={<div className="min-h-screen bg-cream" />}>
            <MobilePlanner activeSection={mobileConfig.activeSection} initialView={mobileConfig.initialView} />
          </Suspense>
        ) : null}
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  )
}
