'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { debounce } from '@/lib/utils/performance'

export interface SearchBarProps {
  /**
   * Callback when search query changes (debounced)
   */
  onSearch: (query: string) => void
  /**
   * Placeholder text
   */
  placeholder?: string
  /**
   * Initial search value
   */
  defaultValue?: string
  /**
   * Debounce delay in milliseconds
   * @default 500
   */
  debounceMs?: number
  /**
   * Additional CSS classes
   */
  className?: string
}

/**
 * SearchBar component with debounced input
 * 
 * Features:
 * - Debounced search (500ms default)
 * - Clear button when text is present
 * - Search icon
 * 
 * @example
 * ```tsx
 * <SearchBar
 *   onSearch={(query) => setSearchQuery(query)}
 *   placeholder="Search venues..."
 * />
 * ```
 */
export function SearchBar({
  onSearch,
  placeholder = 'Search...',
  defaultValue = '',
  debounceMs = 500,
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState(defaultValue)

  // Use debounce utility for better performance
  const debouncedSearch = useCallback(
    debounce((searchQuery: string) => {
      onSearch(searchQuery)
    }, debounceMs),
    [onSearch, debounceMs]
  )

  useEffect(() => {
    debouncedSearch(query)
  }, [query, debouncedSearch])

  const handleClear = () => {
    setQuery('')
    onSearch('')
  }

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-10 pr-10"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
