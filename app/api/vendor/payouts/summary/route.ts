export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVendor } from '@/lib/stripe/connect'
import { centsToDollars, readCents } from '@/lib/money'

export const runtime = 'nodejs'

type VendorTransactionRow = {
  id: string
  booking_id: string
  vendor_id: string
  builder_id: string
  amount: number
  amount_cents?: number | null
  vendor_payout: number
  vendor_payout_cents?: number | null
  payment_type: string
  status: string
  stripe_transfer_id: string | null
  paid_at: string | null
  created_at: string
}

function sumByStatus(transactions: VendorTransactionRow[], statuses: string[]) {
  return transactions
    .filter((transaction) => statuses.includes(transaction.status))
    .reduce((sum, transaction) => {
      const payoutCents = readCents(transaction.vendor_payout_cents, transaction.vendor_payout) ?? 0
      return sum + centsToDollars(payoutCents)
    }, 0)
}

/**
 * Returns vendor payout totals and recent payment activity.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVendor(supabase)

    if (auth.error || !auth.vendor) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const [{ data: account }, { data: transactionRows, error: transactionsError }] = await Promise.all([
      (admin as any)
        .from('vendor_stripe_accounts')
        .select('account_status, charges_enabled, payouts_enabled, requirements_due, stripe_account_id')
        .eq('vendor_id', auth.vendor.id)
        .maybeSingle(),
      (admin as any)
        .from('vendor_transactions')
        .select('id, booking_id, vendor_id, builder_id, amount, amount_cents, vendor_payout, vendor_payout_cents, payment_type, status, stripe_transfer_id, paid_at, created_at')
        .eq('vendor_id', auth.vendor.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (transactionsError) throw new Error(transactionsError.message)

    const transactions = ((transactionRows || []) as VendorTransactionRow[])
    const bookingIds = [...new Set(transactions.map((transaction) => transaction.booking_id))]
    const { data: bookings } = bookingIds.length
      ? await (admin as any)
          .from('vendor_bookings')
          .select('id, event_id, booking_date, events(id, event_name, event_date)')
          .in('id', bookingIds)
      : { data: [] }

    const bookingById = new Map<string, any>((bookings || []).map((booking: any) => [booking.id, booking]))
    const enrichedTransactions = transactions.map((transaction) => {
      const booking = bookingById.get(transaction.booking_id)
      const event = Array.isArray(booking?.events) ? booking.events[0] : booking?.events
      const amountCents = readCents(transaction.amount_cents, transaction.amount) ?? 0
      const vendorPayoutCents = readCents(transaction.vendor_payout_cents, transaction.vendor_payout) ?? 0

      return {
        ...transaction,
        amount: centsToDollars(amountCents),
        vendor_payout: centsToDollars(vendorPayoutCents),
        event_name: event?.event_name ?? 'Event booking',
        event_date: event?.event_date ?? booking?.booking_date ?? null,
      }
    })

    return NextResponse.json({
      account: account || null,
      summary: {
        pending: sumByStatus(transactions, ['pending', 'processing']),
        completed: sumByStatus(transactions, ['succeeded']),
        refunded: sumByStatus(transactions, ['refunded']),
        failed: sumByStatus(transactions, ['failed']),
        count: transactions.length,
      },
      transactions: enrichedTransactions,
    })
  } catch (error) {
    console.error('[vendor.payouts.summary] Failed to load payout summary', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payout summary' },
      { status: 500 }
    )
  }
}
