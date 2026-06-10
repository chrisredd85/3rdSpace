import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: NextRequest, context: { params: { id: string } }) {
  const url = new URL(`/api/venue/community-host-incentive/${context.params.id}/spend-report`, request.url)
  return NextResponse.redirect(url, 308)
}
