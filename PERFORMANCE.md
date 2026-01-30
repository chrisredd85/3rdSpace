# Performance Optimizations

This document outlines the performance optimizations implemented in the 3rdSpace frontend.

## Code Splitting

### Lazy Loading Routes
- Dashboard routes are lazy-loaded to reduce initial bundle size
- Heavy components (calendar, charts) are loaded on-demand
- Loading fallbacks shown during component load

### Example Usage
```tsx
// Lazy load dashboard
const BuilderDashboard = lazy(() => import('./builder/page'))

// Use with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <BuilderDashboard />
</Suspense>
```

## Image Optimization

### Next.js Image Component
- All images use `OptimizedImage` wrapper around Next.js Image
- Automatic WebP/AVIF format conversion
- Responsive sizing with proper width/height
- Lazy loading for below-fold images
- Blur placeholder support

### Configuration
- Image domains configured in `next.config.js`
- Multiple device sizes for responsive images
- Automatic compression enabled

## Data Caching

### React Query Configuration
- **Static data** (venues, vendors): 5 minutes stale time
- **User-specific data**: 1 minute stale time
- **Cache time**: 10 minutes
- Optimistic updates for instant feedback
- Cache invalidation on mutations

### Query Optimization
- Only select needed columns (`.select('id, name, photo')`)
- Pagination with `.range()` for large lists
- Infinite scroll support with `useInfiniteQuery`

## Supabase Query Optimization

### Best Practices
1. **Select specific columns**: Use `.select('id, name, photo')` instead of `*`
2. **Pagination**: Use `.range(from, to)` for large datasets
3. **Indexes**: Ensure proper indexes on filtered columns
4. **Limit results**: Default to 20 items per page

### Example
```tsx
// Optimized query
const { data } = await supabase
  .from('venues')
  .select('id, name, venue_type, city, capacity, hourly_rate, photo_url')
  .eq('is_active', true)
  .range(0, 19) // First page
  .order('created_at', { ascending: false })
```

## Debouncing & Throttling

### Search Inputs
- 500ms debounce for search queries
- Reduces API calls while typing

### Filter Changes
- 300ms debounce for filter updates
- Prevents excessive re-renders

### Auto-save
- 2 seconds debounce for draft saves
- Reduces database writes

### Usage
```tsx
import { debounce } from '@/lib/utils/performance'

const debouncedSearch = debounce((query) => {
  performSearch(query)
}, 500)
```

## Calendar Optimization

### Memoization
- Calendar days calculation memoized with `useMemo`
- Week days calculation memoized with `useCallback`
- Only renders visible month/week

### Performance
- Date calculations cached
- Prevents unnecessary re-renders
- Efficient date manipulation

## Performance Monitoring

### Built-in Monitoring
- Tracks slow operations (>2 seconds)
- Logs page load times
- Monitors Core Web Vitals (ready for integration)

### Usage
```tsx
import { measurePerformance } from '@/lib/utils/performance'

await measurePerformance('fetchEvents', async () => {
  await fetchEvents()
})
```

## Bundle Size Optimization

### Next.js Configuration
- SWC minification enabled
- CSS optimization enabled
- Compression enabled
- Tree-shaking for unused code

### Recommendations
1. Use dynamic imports for heavy libraries
2. Analyze bundle with `@next/bundle-analyzer`
3. Remove unused dependencies
4. Use tree-shaking compatible imports

## Performance Utilities

### Available Functions
- `debounce()` - Delay function execution
- `throttle()` - Limit function execution frequency
- `memoize()` - Cache function results
- `measurePerformance()` - Track execution time
- `createPerformanceMonitor()` - Create monitoring instance

## Best Practices

1. **Always use pagination** for lists > 20 items
2. **Select only needed columns** in queries
3. **Debounce user input** (search, filters)
4. **Memoize expensive calculations**
5. **Lazy load heavy components**
6. **Use OptimizedImage** for all images
7. **Monitor slow operations** in development

## Monitoring Integration

To integrate with monitoring services (Sentry, LogRocket, etc.):

```tsx
// In lib/utils/errorHandling.ts
export function logError(error: Error, context?: Record<string, unknown>) {
  // Add your monitoring service here
  // Sentry.captureException(error, { extra: context })
  // LogRocket.captureException(error, { extra: context })
}
```

## Performance Checklist

- [x] Code splitting for routes
- [x] Lazy loading heavy components
- [x] Image optimization with Next.js Image
- [x] React Query caching configured
- [x] Supabase queries optimized
- [x] Debouncing for search/filters
- [x] Calendar memoization
- [x] Performance monitoring
- [x] Bundle size optimization
- [ ] Bundle analyzer setup (optional)
- [ ] Core Web Vitals integration (optional)
