'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface QuickActionCardProps {
  /**
   * Icon to display
   */
  icon: React.ReactNode
  /**
   * Title text
   */
  title: string
  /**
   * Description text
   */
  description: string
  /**
   * Link href
   */
  href: string
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * QuickActionCard component for dashboard quick actions
 */
export function QuickActionCard({
  icon,
  title,
  description,
  href,
  className,
}: QuickActionCardProps) {
  return (
    <Link href={href}>
      <Card
        className={cn(
          'border-2 border-slate-200 hover:border-forest-500 hover:shadow-xl transition-all duration-300 cursor-pointer group hover:scale-[1.02]',
          className
        )}
      >
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-forest-50 flex-shrink-0 group-hover:bg-forest-100 transition-colors">
              <div className="text-forest-600 text-2xl">
                {icon}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-forest-600 transition-colors">
                {title}
              </h3>
              <p className="text-sm text-slate-600 line-clamp-2">
                {description}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
