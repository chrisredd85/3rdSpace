'use client'

import { VenueSettingsPageShell } from '@/components/venue/VenueSettingsPageShell'
import { RulesManager } from '@/components/venue/RulesManager'

/**
 * Dedicated house rules settings page used by integration tests and owners.
 *
 * @returns Venue rules manager page.
 */
export default function VenueRulesSettingsPage() {
  return (
    <VenueSettingsPageShell
      title="House Rules"
      description="Create mandatory rules, optional guidelines, and insurance requirements."
    >
      {(venueId) => <RulesManager venueId={venueId} />}
    </VenueSettingsPageShell>
  )
}

