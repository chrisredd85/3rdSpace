/**
 * Next.js Edge Middleware
 *
 * Responsibilities:
 *  1. Session refresh — keeps Supabase cookies alive on every request.
 *  2. Auth redirect — unauthenticated users hitting dashboard routes are sent to /login.
 *  3. Role guard — users are redirected to their own dashboard if they land on the
 *     wrong role prefix (e.g. a venue_owner hitting /builder goes to /venue).
 *
 * Public routes bypass all auth checks; API routes and static assets are skipped entirely.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { protectRoute, getAuthUser } from '@/lib/supabase/middleware'
import type { UserType } from '@/lib/types'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup', '/', '/api/auth/login', '/api/auth/signup', '/api/auth/callback']
  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith('/api/auth/'))

  // Allow API routes and static files
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  // Auth routes - redirect to appropriate dashboard if already authenticated
  if (pathname === '/login' || pathname === '/signup') {
    const { user, response } = await getAuthUser(request)
    if (user) {
      // Get user type and redirect to appropriate dashboard
      const userType = (user.user_metadata?.user_type as UserType) || null
      let dashboardPath = '/builder' // Default

      if (userType === 'venue_owner') {
        dashboardPath = '/venue'
      } else if (userType === 'vendor') {
        dashboardPath = '/vendor'
      } else if (userType === 'community_builder') {
        dashboardPath = '/builder'
      }

      const url = request.nextUrl.clone()
      url.pathname = dashboardPath
      // Signal that user was redirected because already signed in (dashboard can show a toast)
      url.searchParams.set('from', 'auth')
      return NextResponse.redirect(url)
    }
    return response
  }

  // Onboarding route - requires authentication, but allow access
  if (pathname === '/onboarding') {
    const result = await protectRoute(request)
    if (result instanceof NextResponse) {
      return result // Redirect to login if not authenticated
    }
    // Allow access to onboarding page
    return result.response
  }

  // Protect dashboard routes (builder, venue, vendor)
  const dashboardRoutes = ['/builder', '/venue', '/vendor']
  if (dashboardRoutes.some((route) => pathname.startsWith(route))) {
    const result = await protectRoute(request)
    if (result instanceof NextResponse) {
      return result // Redirect to login
    }

    // Verify user has access to the requested dashboard
    const { user } = result
    const userType = (user.user_metadata?.user_type as UserType) || null

    // Check if user is accessing the correct dashboard
    if (pathname.startsWith('/builder') && userType !== 'community_builder') {
      // Redirect to correct dashboard
      const url = request.nextUrl.clone()
      if (userType === 'venue_owner') {
        url.pathname = '/venue'
      } else if (userType === 'vendor') {
        url.pathname = '/vendor'
      } else {
        url.pathname = '/builder'
      }
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/venue') && userType !== 'venue_owner') {
      const url = request.nextUrl.clone()
      if (userType === 'community_builder') {
        url.pathname = '/builder'
      } else if (userType === 'vendor') {
        url.pathname = '/vendor'
      } else {
        url.pathname = '/venue'
      }
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/vendor') && userType !== 'vendor') {
      const url = request.nextUrl.clone()
      if (userType === 'community_builder') {
        url.pathname = '/builder'
      } else if (userType === 'venue_owner') {
        url.pathname = '/venue'
      } else {
        url.pathname = '/vendor'
      }
      return NextResponse.redirect(url)
    }

    return result.response
  }

  // For all other routes, just refresh the session
  const { response } = await getAuthUser(request)
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
