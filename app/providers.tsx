'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { ToastProvider } from '@/components/ui/toast'
import { initPerformanceMonitoring } from '@/lib/utils/performance'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: 'always',
            // Static data (venues, vendors) cached for 5 minutes
            staleTime: 5 * 60 * 1000,
            // User-specific data cached for 1 minute
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  )

  useEffect(() => {
    initPerformanceMonitoring()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}
