import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getAuthenticatedBuilderBillingProfile,
  getBuilderBillingSummary,
} from '@/lib/billing/builder-billing'

/**
 * Returns the signed-in builder's event access and subscription state.
 */
export async function GET() {
  const supabase = createClient()
  const auth = await getAuthenticatedBuilderBillingProfile(supabase)

  if (!auth.builder) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  return NextResponse.json({
    builder: auth.builder,
    billing: getBuilderBillingSummary(auth.builder),
  })
}
