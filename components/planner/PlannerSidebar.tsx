/**
 * Purpose: Renders the fixed Agent Planner navigation sidebar for the new `/planner` shell.
 * Props: Accepts optional workspace, navigation count, and active-plan stubs.
 * Key behaviors: Uses responsive icon-rail behavior on smaller screens, highlights active
 * links from the current pathname, and keeps planner navigation in sync with the live plan.
 */
'use client'

import { memo, useEffect, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  FileText,
  MessageSquare,
  Settings,
  Sparkles,
  Store,
  Ticket,
  WalletCards,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface PlannerNavItem {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  badge?: string | number
  live?: boolean
  prefetch?: boolean
}

interface PlannerSidebarProps {
  isCollapsed?: boolean
  workspaceName?: string
  workspaceTier?: string
  hasActivePlan?: boolean
  planId?: string | null
  counts?: PlannerSidebarCounts
}

interface PlannerSidebarCounts {
  experiences?: number
  tickets?: number
  pendingApprovals?: number
}

interface LivePlanSidebarPayload {
  plan: {
    budgetCapCents: number | null
  } | null
  planId: string | null
  messages: Array<{
    message_type?: string
    metadata?: unknown
  }>
}

/**
 * Returns true when the current pathname should mark a planner nav link active.
 */
function isActiveHref(pathname: string, href: string) {
  return href === '/planner' ? pathname === href : pathname.startsWith(href)
}

function readSidebarPayload(): LivePlanSidebarPayload {
  if (typeof window === 'undefined') return { plan: null, planId: null, messages: [] }

  const raw = window.localStorage.getItem('planner-live-plan')
  if (!raw) return { plan: null, planId: null, messages: [] }

  try {
    const parsed = JSON.parse(raw) as Partial<LivePlanSidebarPayload>
    return {
      plan: parsed.plan && typeof parsed.plan === 'object' ? parsed.plan : null,
      planId: typeof parsed.planId === 'string' ? parsed.planId : null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch {
    return { plan: null, planId: null, messages: [] }
  }
}

function countApprovalMessages(messages: LivePlanSidebarPayload['messages']) {
  return messages.filter((message) => message.message_type === 'approval_request').length
}

/**
 * Planner sidebar with brand, workspace switcher, nav items, and monthly agent spend meter.
 */
export const PlannerSidebar = memo(function PlannerSidebar({
  isCollapsed = false,
  workspaceName = 'Embarcadero Collective',
  workspaceTier = 'Pro',
  hasActivePlan,
  planId,
  counts,
}: PlannerSidebarProps) {
  const pathname = usePathname()
  const [livePayload, setLivePayload] = useState<LivePlanSidebarPayload>({ plan: null, planId: null, messages: [] })
  const activePlanId = planId ?? livePayload.planId
  const activePlanExists = hasActivePlan ?? Boolean(activePlanId)
  const pendingApprovalCount = counts?.pendingApprovals ?? countApprovalMessages(livePayload.messages)
  const navItems: PlannerNavItem[] = [
    { label: 'Agent Planner', href: '/planner', icon: Sparkles, live: activePlanExists },
    { label: 'Experiences', href: '/planner/experiences', icon: Bell, badge: counts?.experiences ?? 0, prefetch: true },
    { label: 'Templates', href: '/planner/templates', icon: FileText },
    { label: 'Venues', href: '/planner/venues', icon: Building2, prefetch: true },
    { label: 'Tickets', href: '/planner/tickets', icon: Ticket, badge: counts?.tickets ?? 0 },
    { label: 'Vendors', href: '/planner/vendors', icon: Store, prefetch: true },
    { label: 'Messages', href: '/planner/messages', icon: MessageSquare },
    { label: 'Payments', href: '/planner/payments', icon: CreditCard, badge: pendingApprovalCount },
    { label: 'Billing', href: '/planner/billing', icon: WalletCards },
    { label: 'Analytics', href: '/planner/analytics', icon: BarChart3 },
    { label: 'Settings', href: '/planner/settings', icon: Settings },
  ]

  useEffect(() => {
    setLivePayload(readSidebarPayload())

    function handleLivePlanUpdate(event: Event) {
      const customEvent = event as CustomEvent<Partial<LivePlanSidebarPayload> | null>
      if (!customEvent.detail) {
        setLivePayload({ plan: null, planId: null, messages: [] })
        return
      }

      setLivePayload({
        plan: customEvent.detail.plan && typeof customEvent.detail.plan === 'object' ? customEvent.detail.plan : null,
        planId: typeof customEvent.detail.planId === 'string' ? customEvent.detail.planId : null,
        messages: Array.isArray(customEvent.detail.messages) ? customEvent.detail.messages : [],
      })
    }

    window.addEventListener('planner-live-plan:update', handleLivePlanUpdate)
    return () => window.removeEventListener('planner-live-plan:update', handleLivePlanUpdate)
  }, [])

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className={cn('border-b border-sidebar-border py-5', isCollapsed ? 'px-3' : 'px-4 lg:px-5')}>
        <Link href="/planner" className={cn('flex items-center gap-3', isCollapsed && 'justify-center')}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <span className="font-display text-lg font-bold text-primary-foreground">3</span>
          </div>
          <div className={cn('min-w-0', isCollapsed && 'sr-only')}>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-xl font-bold tracking-tight">3rdPlace</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">Bay Area</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">Agent Planner OS</p>
          </div>
        </Link>

        <button
          type="button"
          className={cn(
            'mt-5 flex w-full items-center justify-between rounded-2xl border border-sidebar-border bg-sidebar-accent/70 px-3 py-3 text-left transition-smooth hover:bg-sidebar-accent',
            isCollapsed && 'hidden'
          )}
        >
          <span className="min-w-0 pr-3">
            <span className="block truncate text-sm font-semibold">{workspaceName}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Founder workspace</span>
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-normal text-primary">
            {workspaceTier}
          </span>
        </button>
      </div>

      <nav
        className={cn('flex-1 space-y-1 overflow-y-auto py-5', isCollapsed ? 'px-2' : 'px-3')}
        data-planner-side-scroll="true"
      >
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = isActiveHref(pathname, item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.prefetch}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                'group flex min-h-11 items-center gap-3 rounded-xl border-l-2 text-sm font-semibold transition-smooth',
                isCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5',
                isActive
                  ? 'border-l-primary bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'border-l-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
              <span className={cn('block flex-1 truncate', isCollapsed && 'sr-only')}>{item.label}</span>
              {item.live && !isCollapsed && (
                <span className="inline-flex rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                  Live
                </span>
              )}
              {typeof item.badge === 'number' && item.badge > 0 && !isCollapsed ? (
                <span className="inline-flex min-w-6 rounded-full bg-sidebar-accent px-2 py-0.5 text-center text-[11px] font-bold text-sidebar-accent-foreground ring-1 ring-sidebar-border">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

    </aside>
  )
})

PlannerSidebar.displayName = 'PlannerSidebar'
