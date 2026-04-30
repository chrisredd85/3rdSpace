import 'server-only'

import { BUILDER_BILLING_PRICES } from '@/lib/billing/builder-billing'
import { toMoney } from '@/lib/payments/vendor-payments'

const DAY_MS = 1000 * 60 * 60 * 24

type BookingRefundRow = {
  id: string
  vendor_id: string
  event_id: string
  status?: string | null
  quoted_price?: number | string | null
  final_price?: number | string | null
  total_amount?: number | string | null
  deposit_amount?: number | string | null
}

type EventRefundRow = {
  id: string
  builder_id: string
  event_date: string
  event_name?: string | null
}

type VendorRefundPolicyRow = {
  id: string
  user_id?: string | null
  name?: string | null
  business_name?: string | null
  email?: string | null
  deposit_refundable?: boolean | null
  deposit_terms?: string | null
  deposit_amount?: number | string | null
  deposit_type?: 'fixed' | 'percentage' | string | null
  deposit_percentage?: number | string | null
}

type VendorPaidTransaction = {
  id: string
  amount: number | string
  payment_type: string
  status: string
}

export type BookingRefundCalculation = {
  booking_id: string
  builder_id: string
  vendor_id: string
  event_id: string
  event_date: string
  days_until_event: number
  is_pro_subscriber: boolean
  platform_fee_refund: number
  vendor_service_refund: number
  total_refund: number
  vendor_total_paid: number
  deposit_amount: number
  refund_breakdown: {
    platform_fee: {
      original: number
      refund: number
      reason: string
    }
    vendor_service: {
      original: number
      refund: number
      reason: string
      terms: string | null
    }
  }
}

function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100
}

function clampMoney(amount: number, min: number, max: number) {
  return roundMoney(Math.min(Math.max(amount, min), max))
}

function calculateDaysUntilEvent(eventDate: string) {
  const eventAt = new Date(eventDate)
  const now = new Date()
  return Math.floor((eventAt.getTime() - now.getTime()) / DAY_MS)
}

function calculateDepositAmount(params: {
  booking: BookingRefundRow
  vendor: VendorRefundPolicyRow
  vendorTotalPaid: number
}) {
  const bookingDeposit = toMoney(params.booking.deposit_amount)
  if (bookingDeposit > 0) return clampMoney(bookingDeposit, 0, params.vendorTotalPaid)

  if (params.vendor.deposit_type === 'percentage') {
    const percentage = toMoney(params.vendor.deposit_percentage)
    return clampMoney(params.vendorTotalPaid * (percentage / 100), 0, params.vendorTotalPaid)
  }

  return clampMoney(toMoney(params.vendor.deposit_amount), 0, params.vendorTotalPaid)
}

function getVendorFallbackTotal(booking: BookingRefundRow) {
  return (
    toMoney(booking.final_price) ||
    toMoney(booking.quoted_price) ||
    toMoney(booking.total_amount)
  )
}

async function getVendorTotalPaid(admin: any, booking: BookingRefundRow) {
  const { data, error } = await admin
    .from('vendor_transactions')
    .select('id, amount, payment_type, status')
    .eq('booking_id', booking.id)
    .eq('status', 'succeeded')
    .neq('payment_type', 'refund')

  if (error) throw new Error(`Failed to load vendor payments: ${error.message}`)

  const paidTransactions = (data || []) as VendorPaidTransaction[]
  const paidTotal = paidTransactions.reduce((sum, tx) => sum + toMoney(tx.amount), 0)

  return roundMoney(paidTotal || getVendorFallbackTotal(booking))
}

async function getActiveBuilderPlanType(admin: any, builderId: string) {
  const { data, error } = await admin
    .from('builder_subscriptions')
    .select('plan_type, status')
    .eq('builder_id', builderId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load builder subscription: ${error.message}`)

  const planType = data?.plan_type
  const isActive = data?.status === 'active' || data?.status === 'trialing'
  return isActive && (planType === 'pro_monthly' || planType === 'pro_annual') ? planType : null
}

/**
 * Calculates the policy-based refund for a cancelled vendor booking.
 *
 * @param admin - Supabase service-role client.
 * @param builderId - Authenticated builder profile id.
 * @param bookingId - Vendor booking id being cancelled.
 * @returns Refund breakdown for platform and vendor payments.
 */
export async function calculateBookingRefund(params: {
  admin: any
  builderId: string
  bookingId: string
}): Promise<BookingRefundCalculation> {
  const { data: booking, error: bookingError } = await params.admin
    .from('vendor_bookings')
    .select('id, vendor_id, event_id, status, quoted_price, final_price, total_amount, deposit_amount')
    .eq('id', params.bookingId)
    .maybeSingle()

  if (bookingError) throw new Error(`Failed to load booking: ${bookingError.message}`)
  if (!booking) {
    const error = new Error('Booking not found')
    ;(error as Error & { status?: number }).status = 404
    throw error
  }

  const refundBooking = booking as BookingRefundRow
  const { data: event, error: eventError } = await params.admin
    .from('events')
    .select('id, builder_id, event_date, event_name')
    .eq('id', refundBooking.event_id)
    .maybeSingle()

  if (eventError) throw new Error(`Failed to load event: ${eventError.message}`)
  if (!event || (event as EventRefundRow).builder_id !== params.builderId) {
    const error = new Error('Not authorized for this booking')
    ;(error as Error & { status?: number }).status = 403
    throw error
  }

  const refundEvent = event as EventRefundRow
  const { data: vendor, error: vendorError } = await params.admin
    .from('vendor_profiles')
    .select('id, user_id, name, business_name, email, deposit_refundable, deposit_terms, deposit_amount, deposit_type, deposit_percentage')
    .eq('id', refundBooking.vendor_id)
    .maybeSingle()

  if (vendorError) throw new Error(`Failed to load vendor refund policy: ${vendorError.message}`)
  if (!vendor) throw new Error('Vendor profile not found')

  const refundVendor = vendor as VendorRefundPolicyRow
  const daysUntilEvent = calculateDaysUntilEvent(refundEvent.event_date)
  const activePlanType = await getActiveBuilderPlanType(params.admin, params.builderId)
  const isProSubscriber = Boolean(activePlanType)
  const platformFeeOriginal = isProSubscriber ? 0 : BUILDER_BILLING_PRICES.payPerEventAmount
  const platformFeeRefund = !isProSubscriber && daysUntilEvent >= 7 ? platformFeeOriginal : 0
  const vendorTotalPaid = await getVendorTotalPaid(params.admin, refundBooking)
  const depositAmount = calculateDepositAmount({
    booking: refundBooking,
    vendor: refundVendor,
    vendorTotalPaid,
  })

  let vendorServiceRefund = 0
  let vendorReason = 'Non-refundable deposit'

  if (refundVendor.deposit_refundable) {
    if (daysUntilEvent >= 30) {
      vendorServiceRefund = vendorTotalPaid
      vendorReason = 'Full refund (>30 days notice)'
    } else if (daysUntilEvent >= 14) {
      vendorServiceRefund = Math.max(vendorTotalPaid - depositAmount, 0)
      vendorReason = 'Partial refund (deposit forfeited)'
    } else {
      vendorReason = 'No refund (<14 days notice)'
    }
  }

  const platformReason = isProSubscriber
    ? 'Pro subscriber - no booking fee paid'
    : daysUntilEvent >= 7
      ? 'Full refund (>7 days notice)'
      : 'No refund (<7 days notice)'

  return {
    booking_id: refundBooking.id,
    builder_id: params.builderId,
    vendor_id: refundBooking.vendor_id,
    event_id: refundEvent.id,
    event_date: refundEvent.event_date,
    days_until_event: daysUntilEvent,
    is_pro_subscriber: isProSubscriber,
    platform_fee_refund: roundMoney(platformFeeRefund),
    vendor_service_refund: clampMoney(vendorServiceRefund, 0, vendorTotalPaid),
    total_refund: roundMoney(platformFeeRefund + clampMoney(vendorServiceRefund, 0, vendorTotalPaid)),
    vendor_total_paid: vendorTotalPaid,
    deposit_amount: depositAmount,
    refund_breakdown: {
      platform_fee: {
        original: roundMoney(platformFeeOriginal),
        refund: roundMoney(platformFeeRefund),
        reason: platformReason,
      },
      vendor_service: {
        original: vendorTotalPaid,
        refund: clampMoney(vendorServiceRefund, 0, vendorTotalPaid),
        reason: vendorReason,
        terms: refundVendor.deposit_terms || null,
      },
    },
  }
}
