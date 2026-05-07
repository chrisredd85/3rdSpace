/**
 * Purpose: Shows the currently active planner context on planner sub-routes.
 * Props: None; reads the same live-plan payload used by the sidebar and live panel.
 * Key behaviors: Hides on the chat route and when no active plan exists, then
 * renders compact plan chips with a one-click path back to the planner chat.
 */
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { plannerDraftStorageKey } from '@/lib/planner/migrateDraft'
import { cn } from '@/lib/utils'

interface LivePlanSnapshot {
  title: string
  guestCount: number | null
  budgetCapCents: number | null
  neighborhood: string | null
}

interface LivePlanPayload {
  plan: LivePlanSnapshot | null
  planId: string | null
}

const emptyPayload: LivePlanPayload = {
  plan: null,
  planId: null,
}

/**
 * Slim sticky active-plan header for planner sub-routes.
 */
export function ActivePlanContextHeader() {
  const pathname = usePathname()
  const [payload, setPayload] = useState<LivePlanPayload>(emptyPayload)

  useEffect(() => {
    setPayload(readLivePlanPayload())

    function handleLivePlanUpdate(event: Event) {
      setPayload(normalizeLivePlanPayload((event as CustomEvent<unknown>).detail))
    }

    window.addEventListener('planner-live-plan:update', handleLivePlanUpdate)
    return () => window.removeEventListener('planner-live-plan:update', handleLivePlanUpdate)
  }, [])

  if (pathname === '/planner' || !payload.plan) return null

  const plan = payload.plan
  const chips = [
    plan.neighborhood,
    typeof plan.guestCount === 'number' ? `${plan.guestCount} guests` : null,
    formatMoney(plan.budgetCapCents),
  ].filter((chip): chip is string => Boolean(chip))

  return (
    <div className="sticky top-0 z-30 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        <Link
          href="/planner"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:border-primary/40 hover:bg-primary/10"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="max-w-[18rem] truncate font-display text-sm font-bold text-foreground sm:max-w-[24rem]" title={plan.title}>
              {plan.title}
            </p>
            {chips.map((chip, index) => (
              <span
                key={`${chip}-${index}`}
                className={cn(
                  'inline-flex max-w-[12rem] items-center rounded-full bg-sidebar-accent px-2.5 py-1 text-xs font-semibold text-muted-foreground',
                  index === 0 && 'text-foreground'
                )}
                title={chip}
              >
                <span className="truncate">{chip}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function readLivePlanPayload(): LivePlanPayload {
  if (typeof window === 'undefined') return emptyPayload

  const raw = window.localStorage.getItem('planner-live-plan')
  if (!raw) return readStoredDraftPayload()

  try {
    return normalizeLivePlanPayload(JSON.parse(raw))
  } catch {
    return readStoredDraftPayload()
  }
}

function readStoredDraftPayload(): LivePlanPayload {
  const raw = window.localStorage.getItem(plannerDraftStorageKey)
  if (!raw) return emptyPayload

  try {
    const record = JSON.parse(raw) as Record<string, unknown>
    const plan = normalizeLivePlanSnapshot(record.plan)
    const planRecord = record.plan && typeof record.plan === 'object'
      ? record.plan as Record<string, unknown>
      : null

    return {
      plan,
      planId: typeof planRecord?.id === 'string' ? planRecord.id : null,
    }
  } catch {
    return emptyPayload
  }
}

function normalizeLivePlanPayload(value: unknown): LivePlanPayload {
  if (!value || typeof value !== 'object') return emptyPayload

  const record = value as Record<string, unknown>
  const plan = normalizeLivePlanSnapshot(record.plan)
  const planRecord = record.plan && typeof record.plan === 'object'
    ? record.plan as Record<string, unknown>
    : null

  return {
    plan,
    planId: typeof record.planId === 'string'
      ? record.planId
      : typeof planRecord?.id === 'string'
        ? planRecord.id
        : null,
  }
}

function normalizeLivePlanSnapshot(value: unknown): LivePlanSnapshot | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  return {
    title: typeof record.title === 'string' && record.title.trim() ? record.title : 'Untitled plan',
    guestCount: readNumber(record.guestCount) ?? readNumber(record.guest_count),
    budgetCapCents: readNumber(record.budgetCapCents) ?? readNumber(record.budget_cap_cents),
    neighborhood: readString(record.neighborhood) ?? readString(record.area),
  }
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function formatMoney(valueCents: number | null | undefined) {
  if (typeof valueCents !== 'number' || valueCents <= 0) return null

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(valueCents / 100)
}
