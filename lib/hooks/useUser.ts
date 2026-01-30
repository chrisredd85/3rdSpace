import { useQuery } from '@tanstack/react-query'
import type { UserType } from '@/lib/types'

export interface User {
  id: string
  email: string | null
  userType: UserType | null
  role: 'builder' | 'owner' | 'vendor'
  companyName?: string | null
}

interface UserResponse {
  user: User
}

interface UserError {
  error: string
}

/**
 * Custom hook to get current authenticated user
 * Uses React Query for caching and automatic refetching
 */
export function useUser() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<User, Error>({
    queryKey: ['user'],
    queryFn: async () => {
      const response = await fetch('/api/auth/user', {
        method: 'GET',
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          // Not authenticated - return null user
          return null as any
        }
        const errorData: UserError = await response.json()
        throw new Error(errorData.error || 'Failed to fetch user')
      }

      const data: UserResponse = await response.json()
      return data.user
    },
    retry: false, // Don't retry on 401 (not authenticated)
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    refetchOnWindowFocus: true, // Refetch when window regains focus
    refetchOnMount: true, // Refetch on component mount
  })

  return {
    user: data || null,
    isLoading,
    isError,
    error: error?.message,
    refetch,
    isAuthenticated: !!data,
  }
}
