/**
 * Performance utilities for optimizing React applications
 */

/**
 * Debounce function - delays execution until after wait time has passed
 * 
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param immediate - If true, trigger on leading edge instead of trailing
 * 
 * @example
 * ```tsx
 * const debouncedSearch = debounce((query) => {
 *   performSearch(query)
 * }, 500)
 * 
 * // Usage
 * debouncedSearch('search term')
 * ```
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate = false
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null
      if (!immediate) func(...args)
    }

    const callNow = immediate && !timeout

    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(later, wait)

    if (callNow) func(...args)
  }
}

/**
 * Throttle function - limits execution to once per wait time
 * 
 * @param func - Function to throttle
 * @param wait - Wait time in milliseconds
 * 
 * @example
 * ```tsx
 * const throttledScroll = throttle(() => {
 *   handleScroll()
 * }, 100)
 * 
 * window.addEventListener('scroll', throttledScroll)
 * ```
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean
  let lastResult: ReturnType<T>

  return function executedFunction(...args: Parameters<T>): ReturnType<T> {
    if (!inThrottle) {
      lastResult = func(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, wait)
    }
    return lastResult
  }
}

/**
 * Memoize function - caches function results
 * 
 * @param func - Function to memoize
 * @param getKey - Function to generate cache key from arguments
 * 
 * @example
 * ```tsx
 * const expensiveCalculation = memoize((a: number, b: number) => {
 *   return a * b * 1000
 * }, (a, b) => `${a}-${b}`)
 * 
 * expensiveCalculation(5, 10) // Calculates
 * expensiveCalculation(5, 10) // Returns cached result
 * ```
 */
export function memoize<T extends (...args: any[]) => any>(
  func: T,
  getKey?: (...args: Parameters<T>) => string
): T {
  const cache = new Map<string, ReturnType<T>>()

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = getKey ? getKey(...args) : JSON.stringify(args)

    if (cache.has(key)) {
      return cache.get(key)!
    }

    const result = func(...args)
    cache.set(key, result)
    return result
  }) as T
}

/**
 * Measure function execution time
 * 
 * @param label - Label for the measurement
 * @param func - Function to measure
 * 
 * @example
 * ```tsx
 * await measurePerformance('fetchEvents', async () => {
 *   await fetchEvents()
 * })
 * ```
 */
export async function measurePerformance<T>(
  label: string,
  func: () => T | Promise<T>
): Promise<T> {
  const start = performance.now()
  const result = await func()
  const end = performance.now()
  const duration = end - start

  if (duration > 2000) {
    console.warn(`[Performance] Slow operation "${label}": ${duration.toFixed(2)}ms`)
  } else if (process.env.NODE_ENV === 'development') {
    console.log(`[Performance] "${label}": ${duration.toFixed(2)}ms`)
  }

  // Log to monitoring service in production
  if (typeof window !== 'undefined' && (window as any).__PERFORMANCE_MONITOR__) {
    ;(window as any).__PERFORMANCE_MONITOR__.log(label, duration)
  }

  return result
}

/**
 * Create a performance monitor
 */
export function createPerformanceMonitor() {
  const metrics: Array<{ label: string; duration: number; timestamp: number }> = []

  return {
    log: (label: string, duration: number) => {
      metrics.push({ label, duration, timestamp: Date.now() })
      
      // Keep only last 100 metrics
      if (metrics.length > 100) {
        metrics.shift()
      }
    },
    getMetrics: () => metrics,
    getAverage: (label?: string) => {
      const filtered = label
        ? metrics.filter((m) => m.label === label)
        : metrics
      
      if (filtered.length === 0) return 0
      
      const sum = filtered.reduce((acc, m) => acc + m.duration, 0)
      return sum / filtered.length
    },
    getSlowOperations: (threshold = 2000) => {
      return metrics.filter((m) => m.duration > threshold)
    },
  }
}

/**
 * Initialize performance monitoring
 */
export function initPerformanceMonitoring() {
  if (typeof window === 'undefined') return

  // Track page load time
  if (document.readyState === 'complete') {
    const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart
    console.log(`[Performance] Page load time: ${loadTime}ms`)
  } else {
    window.addEventListener('load', () => {
      const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart
      console.log(`[Performance] Page load time: ${loadTime}ms`)
    })
  }

  // Track Core Web Vitals
  if ('web-vital' in window) {
    // This would integrate with web-vitals library
    // import { onCLS, onFID, onLCP } from 'web-vitals'
  }

  // Create global performance monitor
  ;(window as any).__PERFORMANCE_MONITOR__ = createPerformanceMonitor()
}

/**
 * Check if code is running in browser
 */
export const isBrowser = typeof window !== 'undefined'

/**
 * Get performance timing
 */
export function getPerformanceTiming() {
  if (!isBrowser || !performance.timing) return null

  const timing = performance.timing
  return {
    pageLoad: timing.loadEventEnd - timing.navigationStart,
    domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
    firstPaint: timing.responseStart - timing.navigationStart,
  }
}
