'use client'

import { cn } from '@/lib/utils'

export interface FilterChipOption {
  /**
   * Unique identifier
   */
  id: string
  /**
   * Display label
   */
  label: string
  /**
   * Optional count badge
   */
  count?: number
}

export interface FilterChipsProps {
  /**
   * Available filter options
   */
  options: FilterChipOption[]
  /**
   * Selected option IDs
   */
  selected: string[]
  /**
   * Toggle handler
   */
  onToggle: (id: string) => void
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * FilterChips component for horizontal chip selector
 * 
 * Used for quick filters like neighborhoods, amenities, service types
 * 
 * @example
 * ```tsx
 * <FilterChips
 *   options={neighborhoods}
 *   selected={selectedNeighborhoods}
 *   onToggle={(id) => {
 *     setSelectedNeighborhoods(prev =>
 *       prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
 *     )
 *   }}
 * />
 * ```
 */
export function FilterChips({
  options,
  selected,
  onToggle,
  className,
}: FilterChipsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => {
        const isSelected = selected.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onToggle(option.id)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition-colors',
              'border-2',
              isSelected
                ? 'bg-clay text-cream border-clay'
                : 'bg-cream/40 text-ink border-tan hover:border-clay'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  'ml-2 px-1.5 py-0.5 rounded-full text-xs',
                  isSelected ? 'bg-cream/20' : 'bg-cream-deep/40'
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
