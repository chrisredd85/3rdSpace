'use client'

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

import type { EntityReadinessIndicator, EntityReadinessIcon, EntityReadinessTone } from '@/lib/planner/entityStripeReadiness'
import { cn } from '@/lib/utils'

const ICONS: Record<EntityReadinessIcon, LucideIcon> = {
  Clock,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
}

const TONE_CLASSES: Record<EntityReadinessTone, string> = {
  muted: 'border-tan bg-cream text-ink-soft',
  warning: 'border-ochre/30 bg-ochre-tint text-ochre',
  destructive: 'border-brick/30 bg-brick-tint text-brick',
  success: 'border-forest/25 bg-forest-tint text-forest',
}

export function EntityReadinessBadge({
  indicator,
  className,
}: {
  indicator: EntityReadinessIndicator | null
  className?: string
}) {
  if (!indicator) return null

  const Icon = ICONS[indicator.icon]

  return (
    <div className={cn('flex max-w-full flex-col items-start gap-0.5', className)}>
      <span
        data-readiness-icon={indicator.icon}
        data-readiness-tone={indicator.tone}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em]',
          TONE_CLASSES[indicator.tone],
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{indicator.label}</span>
      </span>
      {indicator.subtext ? (
        <span className="max-w-[15rem] text-[10px] font-medium leading-snug text-ink-faint">
          {indicator.subtext}
        </span>
      ) : null}
    </div>
  )
}
