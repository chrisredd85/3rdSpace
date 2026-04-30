import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database'

/**
 * CLIENT-ONLY Supabase Client
 * 
 * Server/Client Boundary:
 * - Use in: Client Components ('use client')
 * - Do not use in: API routes, Server Components, Middleware
 * 
 * For server-side code, use '@/lib/supabase/server' instead.
 * 
 * This file does NOT import server-only modules (no 'next/headers', no 'server-only').
 */

/** Returns a typed Supabase browser client. Use in 'use client' components only. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Legacy singleton export kept for components that import `supabase` directly.
// New code should call createClient() so each render gets a fresh, typed instance.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = supabaseUrl && supabaseAnonKey
  ? createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
  : (() => {
      if (typeof window !== 'undefined') {
        console.error('Missing Supabase environment variables')
      }
      // Return a mock that will fail gracefully
      return null as any
    })()
