export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { POST as runJobs } from '@/app/api/internal/jobs/run/route'

/**
 * Cron-facing alias for the internal background job runner.
 */
export async function POST(request: NextRequest) {
  return runJobs(request)
}

/**
 * Supports Vercel Cron GET invocations while preserving worker/admin auth.
 */
export async function GET(request: NextRequest) {
  return runJobs(request)
}
