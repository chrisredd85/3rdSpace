'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { MobilePlanner, type MobileSection, type MobileView } from '@/components/planner/mobile/MobilePlanner'

type MobileRouteConfig = {
  activeSection: MobileSection
  initialView?: MobileView
}

const mobileRouteMap: Record<string, MobileRouteConfig> = {
  '/planner': { activeSection: 'planner' },
  '/planner/new-plan': { activeSection: 'planner', initialView: 'new-plan' },
  '/planner/venues': { activeSection: 'planner', initialView: 'venues' },
  '/planner/payments': { activeSection: 'approvals' },
  '/planner/messages': { activeSection: 'messages' },
  '/planner/vendors': { activeSection: 'vendors' },
  '/planner/outreach': { activeSection: 'outreach' },
  '/planner/analytics': { activeSection: 'analytics' },
  '/planner/tickets': { activeSection: 'ticketing' },
  '/planner/billing': { activeSection: 'billing' },
  '/planner/settings': { activeSection: 'settings' },
}

export function PlannerResponsiveLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const mobileConfig = mobileRouteMap[pathname]

  if (!mobileConfig) return <>{children}</>

  return (
    <>
      <div className="lg:hidden">
        <MobilePlanner activeSection={mobileConfig.activeSection} initialView={mobileConfig.initialView} />
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  )
}
