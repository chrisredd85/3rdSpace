export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminHealthData } from '@/lib/server/admin-health'
import { getAdminOpsData } from '@/lib/server/admin-ops'

export async function GET() {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient()
  const [data, health] = await Promise.all([
    getAdminOpsData(admin as any),
    getAdminHealthData(admin as any),
  ])

  return NextResponse.json({ ...data, health })
}
