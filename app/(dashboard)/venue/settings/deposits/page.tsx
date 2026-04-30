'use client'

import { VenueSettingsPageShell } from '@/components/venue/VenueSettingsPageShell'
import { DepositSettings } from '@/components/venue/DepositSettings'

/**
 * Dedicated deposit settings page used by integration tests and owners.
 *
 * @returns Venue deposit settings page.
 */
export default function VenueDepositsSettingsPage() {
  return (
    <VenueSettingsPageShell
      title="Deposits"
      description="Require fixed or percentage deposits for venue booking requests."
    >
      {(venueId) => <DepositSettings venueId={venueId} />}
    </VenueSettingsPageShell>
  )
}

