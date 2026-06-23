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
  Handshake,
  Mail,
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

interface PlannerAccountState {
  workspaceName: string
  workspaceDetail: string
  membershipLabel: string
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

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function readEmailName(email: string | null | undefined) {
  if (!email) return null
  const [localPart] = email.split('@')
  return localPart ? titleize(localPart.replace(/[._+-]+/g, ' ')) : null
}

function readUserTypeLabel(userType: string | null | undefined) {
  if (!userType) return 'Creator account'
  if (userType === 'community_builder' || userType === 'builder') return 'Community builder account'
  return `${titleize(userType)} account`
}

function readMembershipLabel(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Planner sidebar with brand, workspace context, and the full planner nav.
 */
export const PlannerSidebar = memo(function PlannerSidebar({
  isCollapsed = false,
  workspaceName,
  workspaceTier,
  hasActivePlan,
  planId,
  counts,
}: PlannerSidebarProps) {
  const pathname = usePathname()
  const [livePayload, setLivePayload] = useState<LivePlanSidebarPayload>({ plan: null, planId: null, messages: [] })
  const [accountState, setAccountState] = useState<PlannerAccountState>({
    workspaceName: workspaceName ?? 'Creator account',
    workspaceDetail: 'Sign in to personalize',
    membershipLabel: workspaceTier ?? 'Account',
  })
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
    { label: 'Outreach', href: '/planner/outreach', icon: Mail },
    { label: 'Messages', href: '/planner/messages', icon: MessageSquare },
    { label: 'Payments', href: '/planner/payments', icon: CreditCard, badge: pendingApprovalCount },
    { label: 'Settlements', href: '/planner/settlements', icon: Handshake },
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

  useEffect(() => {
    if (workspaceName || workspaceTier) {
      setAccountState((current) => ({
        workspaceName: workspaceName ?? current.workspaceName,
        workspaceDetail: current.workspaceDetail,
        membershipLabel: workspaceTier ?? current.membershipLabel,
      }))
    }
  }, [workspaceName, workspaceTier])

  useEffect(() => {
    let isCancelled = false

    async function loadAccountContext() {
      try {
        const [userResponse, billingResponse] = await Promise.all([
          fetch('/api/auth/user'),
          fetch('/api/builder/billing/status'),
        ])

        const userPayload = userResponse.ok ? await userResponse.json() : null
        const billingPayload = billingResponse.ok ? await billingResponse.json() : null
        if (isCancelled) return

        const user = userPayload?.user
        const builder = billingPayload?.builder
        const billing = billingPayload?.billing
        const email = typeof user?.email === 'string' ? user.email : null
        const companyName = typeof user?.companyName === 'string' ? user.companyName.trim() : ''
        const builderName = typeof builder?.name === 'string' ? builder.name.trim() : ''
        const displayName = workspaceName ?? (companyName || builderName || readEmailName(email) || 'Creator account')
        const detail = email ? `${readUserTypeLabel(user?.userType)} - ${email}` : readUserTypeLabel(user?.userType)
        const membership = workspaceTier ?? readMembershipLabel(billing?.tierLabel) ?? 'Free Trial'

        setAccountState({
          workspaceName: displayName,
          workspaceDetail: detail,
          membershipLabel: membership,
        })
      } catch {
        if (isCancelled) return
        setAccountState({
          workspaceName: workspaceName ?? 'Creator account',
          workspaceDetail: 'Sign in to personalize',
          membershipLabel: workspaceTier ?? 'Account',
        })
      }
    }

    void loadAccountContext()

    return () => {
      isCancelled = true
    }
  }, [workspaceName, workspaceTier])

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-tan bg-cream/80 text-ink">
      <div className={cn('border-b border-tan py-5', isCollapsed ? 'px-3' : 'px-4 lg:px-5')}>
        <Link href="/planner" className={cn('flex items-center gap-3', isCollapsed && 'justify-center')}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-clay shadow-glow">
            <span className="font-display text-lg font-bold text-cream">3</span>
          </div>
          <div className={cn('min-w-0', isCollapsed && 'sr-only')}>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-xl font-semibold tracking-normal text-ink">3rdPlace</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-clay-deep">Bay Area</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-soft">Agent Planner OS</p>
          </div>
        </Link>

        <div
          className={cn(
            'mt-5 flex w-full items-center justify-between rounded-lg border border-tan bg-cream px-3 py-3 text-left shadow-sm',
            isCollapsed && 'hidden'
          )}
        >
          <span className="min-w-0 pr-3">
            <span className="block truncate text-sm font-semibold text-ink">{accountState.workspaceName}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-soft">{accountState.workspaceDetail}</span>
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-clay/30 bg-clay-tint px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-normal text-clay">
            {accountState.membershipLabel}
          </span>
        </div>
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
                'group flex min-h-11 items-center gap-3 rounded-md border-l-2 text-sm font-semibold transition-smooth',
                isCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5',
                isActive
                  ? 'border-l-clay bg-clay-tint text-ink'
                  : 'border-l-transparent text-ink-soft hover:bg-cream-deep hover:text-ink'
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-clay' : 'text-ink-faint group-hover:text-clay-deep')} />
              <span className={cn('block flex-1 truncate', isCollapsed && 'sr-only')}>{item.label}</span>
              {item.live && !isCollapsed && (
                <span className="inline-flex rounded-full bg-clay px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cream">
                  Live
                </span>
              )}
              {typeof item.badge === 'number' && item.badge > 0 && !isCollapsed ? (
                <span className="inline-flex min-w-6 rounded-full bg-cream-deep px-2 py-0.5 text-center text-[11px] font-bold text-ink-soft ring-1 ring-tan">
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
