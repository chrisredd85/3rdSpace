export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVendorProfile, getInvoiceContext } from '@/lib/invoices/vendor-invoices'

export const runtime = 'nodejs'

/**
 * Gets invoice details for an authenticated vendor owner.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const context = await getInvoiceContext(admin as any, parsedId.data)

    if (!context) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const auth = await getAuthenticatedVendorProfile(supabase, context.invoice.vendor_id)
    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    return NextResponse.json(context)
  } catch (error) {
    console.error('[vendor.invoices.detail] Failed to load invoice', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load invoice' },
      { status: 500 }
    )
  }
}
