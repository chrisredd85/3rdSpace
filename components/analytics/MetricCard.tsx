import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

type MetricColor = 'green' | 'blue' | 'purple' | 'yellow' | 'slate'

interface MetricCardProps {
  title: string
  value: string
  icon: ReactNode
  trend?: number
  trendLabel?: string
  subtitle?: string
  color?: MetricColor
}

const colorClasses: Record<MetricColor, string> = {
  green: 'bg-emerald-500/15 text-emerald-300',
  blue: 'bg-primary/15 text-primary/80',
  purple: 'bg-primary/15 text-primary',
  yellow: 'bg-yellow-500/15 text-yellow-200',
  slate: 'bg-sidebar-accent/40 text-foreground',
}

/**
 * Displays one KPI with optional trend and supporting label.
 */
export function MetricCard({
  title,
  value,
  icon,
  trend,
  trendLabel,
  subtitle,
  color = 'green',
}: MetricCardProps) {
  const hasTrend = typeof trend === 'number'
  const trendIsPositive = (trend || 0) >= 0

  return (
    <div className="rounded-lg border border-border bg-card/40 p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={cn('rounded-lg p-3', colorClasses[color])}>{icon}</div>
        {hasTrend && (
          <div className={cn('flex items-center gap-1 text-sm font-semibold', trendIsPositive ? 'text-emerald-300' : 'text-destructive')}>
            {trendIsPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {Math.abs(trend || 0).toFixed(1)}%
          </div>
        )}
      </div>

      <p className="mb-1 text-sm text-muted-foreground">{title}</p>
      <p className="mb-2 text-3xl font-bold text-foreground">{value}</p>

      {trendLabel && <p className="text-xs text-muted-foreground">{trendLabel}</p>}
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
