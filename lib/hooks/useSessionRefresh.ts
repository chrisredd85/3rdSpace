import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from './useUser'

/**
 * Hook to automatically refresh session and handle expiration
 * Checks session validity periodically and redirects to login if expired
 */
export function useSessionRefresh() {
  const { user, isAuthenticated, refetch } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    // Refresh session every 5 minutes
    const refreshInterval = setInterval(async () => {
      try {
        // Refetch user data to check if session is still valid
        const result = await refetch()
        
        // If refetch fails or returns no user, session expired
        if (!result.data) {
          clearInterval(refreshInterval)
          router.push('/login?error=session_expired&message=Your session has expired. Please sign in again.')
        }
      } catch (error) {
        console.error('Session refresh error:', error)
        // On error, clear interval and redirect to login
        clearInterval(refreshInterval)
        router.push('/login?error=session_error&message=Session error. Please sign in again.')
      }
    }, 5 * 60 * 1000) // 5 minutes

    // Also refresh on window focus (user returns to tab)
    const handleFocus = () => {
      refetch()
    }
    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(refreshInterval)
      window.removeEventListener('focus', handleFocus)
    }
  }, [isAuthenticated, refetch, router])

  return { user, isAuthenticated }
}
