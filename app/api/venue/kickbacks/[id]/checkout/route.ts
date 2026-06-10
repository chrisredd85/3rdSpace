import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(request: NextRequest, context: { params: { id: string } }) {
  return redirectToCommunityHostIncentive(request, context.params.id, 'checkout')
}

function redirectToCommunityHostIncentive(request: NextRequest, id: string, action: string) {
  const url = new URL(`/api/venue/community-host-incentive/${id}/${action}`, request.url)
  return NextResponse.redirect(url, 308)
}
