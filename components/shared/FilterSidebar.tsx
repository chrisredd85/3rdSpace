'use client'

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { debounce } from '@/lib/utils/performance'

export interface FilterOption {
  id: string
  label: string
  count?: number
}

export interface FilterGroup {
  id: string
  title: string
  options: FilterOption[]
  type: 'checkbox' | 'range'
  rangeConfig?: {
    min: number
    max: number
    step: number
    unit?: string
  }
}

export interface FilterSidebarProps {
  /**
   * Filter groups configuration
   */
  filters: FilterGroup[]
  /**
   * Current filter values
   */
  values: Record<string, string[] | [number, number]>
  /**
   * Change handler
   */
  onFilterChange: (groupId: string, value: string[] | [number, number]) => void
  /**
   * Reset all filters
   */
  onReset?: () => void
  /**
   * Apply filters handler
   */
  onApply?: () => void
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * FilterSidebar component for vertical filter panel
 * 
 * Features:
 * - Collapsible filter groups
 * - Checkbox filters
 * - Range sliders for price
 * - Active filter count badge
 * - Apply/Reset buttons
 * 
 * @example
 * ```tsx
 * <FilterSidebar
 *   filters={filterGroups}
 *   values={filterValues}
 *   onFilterChange={(groupId, value) => {
 *     setFilterValues(prev => ({ ...prev, [groupId]: value }))
 *   }}
 *   onReset={() => setFilterValues({})}
 * />
 * ```
 */
export function FilterSidebar({
  filters,
  values,
  onFilterChange,
  onReset,
  onApply,
  className,
}: FilterSidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(filters.map((f) => f.id))
  )

  // Debounce filter changes for better performance
  const debouncedFilterChange = useCallback(
    debounce((groupId: string, value: string[] | [number, number]) => {
      onFilterChange(groupId, value)
    }, 300),
    [onFilterChange]
  )

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const getActiveFilterCount = () => {
    return Object.values(values).reduce((count, value) => {
      if (Array.isArray(value)) {
        if (value.length === 2 && typeof value[0] === 'number') {
          // Range filter - check if not at defaults
          const group = filters.find((f) => f.id === Object.keys(values).find((k) => values[k] === value))
          if (group?.rangeConfig) {
            const [min, max] = value as [number, number]
            if (
              min !== group.rangeConfig.min ||
              max !== group.rangeConfig.max
            ) {
              return count + 1
            }
          }
        } else {
          // Checkbox filter
          return count + (value as string[]).length
        }
      }
      return count
    }, 0)
  }

  const activeCount = getActiveFilterCount()

  return (
    <>
      {/* Mobile Bottom Sheet Overlay */}
      <div className={cn(
        'fixed inset-0 bg-cream/80 backdrop-blur-sm z-40 md:hidden',
        className?.includes('mobile-open') ? 'block' : 'hidden'
      )} />
      
      {/* Filter Panel */}
      <div className={cn(
        'w-full md:w-64 space-y-4',
        'fixed md:relative bottom-0 left-0 right-0 md:inset-auto',
        'bg-cream/40 md:bg-transparent',
        'rounded-t-2xl md:rounded-none',
        'shadow-lg md:shadow-none',
        'z-50 md:z-auto',
        'max-h-[80vh] md:max-h-none',
        'overflow-y-auto md:overflow-visible',
        'p-4 md:p-0',
        className?.includes('mobile-open') ? 'block' : 'hidden md:block',
        className
      )}>
        <div className="flex items-center justify-between mb-4 md:mb-0">
          <h3 className="text-lg font-semibold text-ink">Filters</h3>
        {activeCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-clay/15 text-clay">
              {activeCount} active
            </span>
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                className="text-sm text-ink-soft hover:text-ink"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {filters.map((filter) => {
          const isExpanded = expandedGroups.has(filter.id)
          const filterValue = values[filter.id] || (filter.type === 'range' ? [filter.rangeConfig?.min || 0, filter.rangeConfig?.max || 1000] : [])

          return (
            <Card key={filter.id}>
              <CardHeader
                className="cursor-pointer"
                onClick={() => toggleGroup(filter.id)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    {filter.title}
                  </CardTitle>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-ink-soft/60" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-soft/60" />
                  )}
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="space-y-3">
                  {filter.type === 'checkbox' ? (
                    <div className="space-y-2">
                      {filter.options.map((option) => {
                        const isSelected = (filterValue as string[]).includes(option.id)
                        return (
                          <label
                            key={option.id}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                const current = (filterValue as string[]) || []
                                const updated = isSelected
                                  ? current.filter((id) => id !== option.id)
                                  : [...current, option.id]
                                debouncedFilterChange(filter.id, updated)
                              }}
                              className="h-4 w-4 text-clay focus:ring-clay"
                            />
                            <span className="text-sm text-ink flex-1">
                              {option.label}
                            </span>
                            {option.count !== undefined && (
                              <span className="text-xs text-ink-soft">
                                ({option.count})
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink-soft">
                          {filter.rangeConfig?.unit || '$'}
                          {((filterValue as [number, number])?.[0] || filter.rangeConfig?.min || 0).toLocaleString()}
                        </span>
                        <span className="text-ink-soft">
                          {filter.rangeConfig?.unit || '$'}
                          {((filterValue as [number, number])?.[1] || filter.rangeConfig?.max || 1000).toLocaleString()}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={filter.rangeConfig?.min || 0}
                            max={filter.rangeConfig?.max || 1000}
                            step={filter.rangeConfig?.step || 10}
                            value={(filterValue as [number, number])?.[0] || filter.rangeConfig?.min || 0}
                            onChange={(e) => {
                              const min = parseInt(e.target.value) || filter.rangeConfig?.min || 0
                              const max = (filterValue as [number, number])?.[1] || filter.rangeConfig?.max || 1000
                              debouncedFilterChange(filter.id, [min, max])
                            }}
                            className="flex-1 h-8 rounded-md border border-tan px-2 text-sm"
                          />
                          <span className="text-ink-soft/60">to</span>
                          <input
                            type="number"
                            min={filter.rangeConfig?.min || 0}
                            max={filter.rangeConfig?.max || 1000}
                            step={filter.rangeConfig?.step || 10}
                            value={(filterValue as [number, number])?.[1] || filter.rangeConfig?.max || 1000}
                            onChange={(e) => {
                              const min = (filterValue as [number, number])?.[0] || filter.rangeConfig?.min || 0
                              const max = parseInt(e.target.value) || filter.rangeConfig?.max || 1000
                              debouncedFilterChange(filter.id, [min, max])
                            }}
                            className="flex-1 h-8 rounded-md border border-tan px-2 text-sm"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="range"
                            min={filter.rangeConfig?.min || 0}
                            max={filter.rangeConfig?.max || 1000}
                            step={filter.rangeConfig?.step || 10}
                            value={(filterValue as [number, number])?.[0] || filter.rangeConfig?.min || 0}
                            onChange={(e) => {
                              const min = parseInt(e.target.value)
                              const max = (filterValue as [number, number])?.[1] || filter.rangeConfig?.max || 1000
                              debouncedFilterChange(filter.id, [Math.min(min, max), max])
                            }}
                            className="flex-1"
                          />
                          <input
                            type="range"
                            min={filter.rangeConfig?.min || 0}
                            max={filter.rangeConfig?.max || 1000}
                            step={filter.rangeConfig?.step || 10}
                            value={(filterValue as [number, number])?.[1] || filter.rangeConfig?.max || 1000}
                            onChange={(e) => {
                              const min = (filterValue as [number, number])?.[0] || filter.rangeConfig?.min || 0
                              const max = parseInt(e.target.value)
                              debouncedFilterChange(filter.id, [min, Math.max(min, max)])
                            }}
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      {onApply && (
        <div className="pt-4 border-t sticky md:static bottom-0 bg-cream/40 md:bg-transparent pb-4 md:pb-0">
          <div className="flex gap-2 md:block">
            {onReset && (
              <Button 
                variant="outline" 
                onClick={onReset} 
                className="flex-1 md:hidden min-h-[44px]"
              >
                Reset
              </Button>
            )}
            <Button onClick={onApply} className="flex-1 md:w-full min-h-[44px]">
              Apply Filters
            </Button>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
