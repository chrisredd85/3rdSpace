import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * External uptime-monitor endpoint.
 * Keep the payload intentionally small so it does not expose build or env data.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
    },
    { status: 200 }
  )
}
