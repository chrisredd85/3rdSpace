import { NextResponse } from 'next/server'
import packageJson from '@/package.json'

export const dynamic = 'force-dynamic'

type CheckStatus = 'ok' | 'error'

interface HealthChecks {
  database: CheckStatus
  stripe: CheckStatus
  resend: CheckStatus
}

/**
 * External uptime-monitor endpoint. Checks stay intentionally cheap:
 * one Supabase metadata query and env-presence checks for Stripe and Resend.
 */
export async function GET() {
  const checks: HealthChecks = {
    database: await checkDatabase(),
    stripe: checkEnv('STRIPE_SECRET_KEY'),
    resend: checkEnv('RESEND_API_KEY'),
  }

  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.VERCEL_GIT_COMMIT_SHA ?? packageJson.version,
      checks,
    },
    { status: 200 }
  )
}

function checkEnv(name: string): CheckStatus {
  return process.env[name] ? 'ok' : 'error'
}

async function checkDatabase(): Promise<CheckStatus> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return 'error'
  }

  try {
    const { createServiceRoleClient } = await import('@/lib/supabase/server')
    const supabase = createServiceRoleClient()
    const { error } = await supabase
      .from('plans')
      .select('id', { count: 'exact', head: true })
      .limit(1)

    return error ? 'error' : 'ok'
  } catch (error) {
    console.error('[health] database check failed', error)
    return 'error'
  }
}
