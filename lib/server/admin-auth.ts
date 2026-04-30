import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type AdminContext =
  | {
      authorized: true
      user: {
        id: string
        email: string | null
      }
    }
  | {
      authorized: false
      status: 401 | 403
      error: string
    }

function getConfiguredAdmins() {
  return new Set(
    (process.env.ADMIN_EMAILS || process.env.INTERNAL_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Checks whether the current signed-in user may access internal operations.
 */
export async function getAdminContext(): Promise<AdminContext> {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { authorized: false, status: 401, error: 'Unauthorized' }
  }

  const email = user.email?.toLowerCase() ?? ''
  const configuredAdmins = getConfiguredAdmins()
  const appMetadata = user.app_metadata as Record<string, unknown> | null
  const isAdmin =
    configuredAdmins.has(email) ||
    appMetadata?.role === 'admin' ||
    appMetadata?.is_admin === true

  if (!isAdmin) {
    return { authorized: false, status: 403, error: 'Admin access required' }
  }

  return {
    authorized: true,
    user: {
      id: user.id,
      email: user.email ?? null,
    },
  }
}

/**
 * Allows a cron/worker request signed with WORKER_SECRET, or a normal admin session.
 */
export async function getWorkerOrAdminContext(request: Request): Promise<AdminContext> {
  const workerSecret = process.env.WORKER_SECRET
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null

  if (workerSecret && token === workerSecret) {
    return {
      authorized: true,
      user: {
        id: 'worker',
        email: 'worker@internal',
      },
    }
  }

  return getAdminContext()
}
