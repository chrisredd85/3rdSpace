import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/toast'
import { createMockSupabaseClient } from './test-utils/mock-supabase'

// Create a test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface AllTheProvidersProps {
  children: React.ReactNode
  queryClient?: QueryClient
}

function AllTheProviders({ children, queryClient }: AllTheProvidersProps) {
  const client = queryClient || createTestQueryClient()

  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient
}

/**
 * Custom render function that includes all providers
 * 
 * @example
 * ```tsx
 * const { getByText } = render(<MyComponent />)
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  { queryClient, ...renderOptions }: CustomRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AllTheProviders queryClient={queryClient}>
        {children}
      </AllTheProviders>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

// Re-export everything from React Testing Library
export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

// Export mock utilities
export { createMockSupabaseClient }

/**
 * Wait for async updates to complete
 */
export async function waitForAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Mock user for testing
 */
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  user_metadata: {
    user_type: 'community_builder',
  },
}

/**
 * Mock venue for testing
 */
export const mockVenue = {
  id: 'test-venue-id',
  name: 'Test Venue',
  venue_type: 'loft_warehouse',
  city: 'San Francisco',
  state: 'CA',
  capacity: 100,
  hourly_rate: 200,
  photo_url: 'https://example.com/venue.jpg',
  is_active: true,
  is_verified: true,
}

/**
 * Mock vendor for testing
 */
export const mockVendor = {
  id: 'test-vendor-id',
  business_name: 'Test Vendor',
  service_type: 'dj',
  service_area: 'San Francisco',
  is_active: true,
  is_verified: true,
}

/**
 * Mock event for testing
 */
export const mockEvent = {
  id: 'test-event-id',
  title: 'Test Event',
  event_type: 'networking',
  event_date: '2024-12-31',
  start_time: '18:00:00',
  budget: 5000,
  status: 'planning',
  organizer_id: 'test-user-id',
}

/**
 * Helper to create a mock Supabase response
 */
export function createMockResponse<T>(data: T, error: any = null) {
  return {
    data,
    error,
    count: null,
    status: error ? 400 : 200,
    statusText: error ? 'Bad Request' : 'OK',
  }
}

/**
 * Helper to wait for a query to resolve
 */
export async function waitForQuery(queryFn: () => Promise<any>, timeout = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      await queryFn()
      return
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Query did not resolve within timeout')
}
