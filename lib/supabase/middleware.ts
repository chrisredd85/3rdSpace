import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * Create Supabase client for middleware
 */
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  return { supabase, response }
}

/**
 * Check if user is authenticated
 * Automatically refreshes session if needed
 * Returns user and response with updated cookies
 */
export async function getAuthUser(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request)

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  // Invalid or revoked refresh token – clear session so we don't keep sending bad cookies
  if (error?.code === 'refresh_token_not_found' || error?.message?.includes('Refresh Token Not Found')) {
    await supabase.auth.signOut()
    return { user: null, response }
  }

  if (error || !user) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      const { data: { user: refreshedUser } } = await supabase.auth.getUser()
      return { user: refreshedUser || null, response }
    }
  }

  return { user: user || null, response }
}

/**
 * Protect routes - redirect to login if not authenticated
 */
export async function protectRoute(request: NextRequest) {
  const { user, response } = await getAuthUser(request)

  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return { user, response }
}
