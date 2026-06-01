'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface StatCardProps {
  /**
   * Label text displayed above the value
   */
  label: string
  /**
   * Main value to display (can be number or string)
   */
  value: string | number
  /**
   * Optional change indicator (percentage or amount)
   */
  change?: string | number
  /**
   * Direction of change (up = positive, down = negative)
   */
  changeDirection?: 'up' | 'down'
  /**
   * Optional icon to display
   */
  icon?: React.ReactNode
  /**
   * Optional background color for icon container
   */
  iconBgColor?: string
  /**
   * Optional icon color
   */
  iconColor?: string
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * StatCard component for displaying statistics with optional change indicators
 * 
 * @example
 * ```tsx
 * <StatCard
 *   label="Total Revenue"
 *   value="$12,500"
 *   change="12.5%"
 *   changeDirection="up"
 * />
 * ```
 */
export function StatCard({
  label,
  value,
  change,
  changeDirection,
  icon,
  iconBgColor = 'bg-clay/15',
  iconColor = 'text-clay',
  className,
}: StatCardProps) {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString() : value

  return (
    <Card className={cn('hover:shadow-md transition-shadow', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-semibold text-ink-soft uppercase tracking-wide">{label}</p>
            <p className="text-3xl sm:text-4xl font-bold text-ink mt-2 tracking-tight">
              {formattedValue}
            </p>
            {change !== undefined && (
              <div
                className={cn(
                  'flex items-center gap-1 mt-2 text-sm font-medium',
                  changeDirection === 'up'
                    ? 'text-clay'
                    : changeDirection === 'down'
                    ? 'text-brick'
                    : 'text-ink-soft'
                )}
              >
                {changeDirection === 'up' && (
                  <TrendingUp className="h-4 w-4" />
                )}
                {changeDirection === 'down' && (
                  <TrendingDown className="h-4 w-4" />
                )}
                {changeDirection && (
                  <span>
                    {typeof change === 'number'
                      ? `${change > 0 ? '+' : ''}${change.toLocaleString()}`
                      : change}
                  </span>
                )}
              </div>
            )}
          </div>
          {icon && (
            <div className={cn('h-14 w-14 rounded-lg flex items-center justify-center flex-shrink-0', iconBgColor)}>
              <div className={iconColor}>{icon}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
