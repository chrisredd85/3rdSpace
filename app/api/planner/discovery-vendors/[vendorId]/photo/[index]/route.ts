export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest } from 'next/server'
import { getDiscoveryPhoto } from '@/lib/server/discovery-photo'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ vendorId: string; index: string }> },
) {
  const { vendorId, index } = await context.params
  return getDiscoveryPhoto('discovery_vendor', vendorId, index)
}
