import { redirect } from 'next/navigation'

/**
 * Keeps the legacy vendor requests URL working after the booking dashboard move.
 *
 * @returns Redirect to vendor bookings.
 */
export default function VendorRequestsRedirectPage() {
  redirect('/vendor/bookings')
}
