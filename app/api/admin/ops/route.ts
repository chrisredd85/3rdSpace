export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminOpsData } from '@/lib/server/admin-ops'

export async function GET() {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient()
  const data = await getAdminOpsData(admin as any)
  return NextResponse.json(data)
}
