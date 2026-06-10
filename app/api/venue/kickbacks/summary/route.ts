import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(request: NextRequest) {
  const url = new URL('/api/venue/community-host-incentive/summary', request.url)
  return NextResponse.redirect(url, 308)
}
