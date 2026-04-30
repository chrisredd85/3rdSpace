'use client'

import { VenueSettingsPageShell } from '@/components/venue/VenueSettingsPageShell'
import { UniqueFeaturesEditor } from '@/components/venue/UniqueFeaturesEditor'

/**
 * Dedicated unique features settings page used by integration tests and owners.
 *
 * @returns Unique venue features editor page.
 */
export default function VenueUniqueFeaturesSettingsPage() {
  return (
    <VenueSettingsPageShell
      title="Unique Features"
      description="Describe what makes your venue stand out and generate searchable feature tags."
    >
      {(venueId) => <UniqueFeaturesEditor venueId={venueId} />}
    </VenueSettingsPageShell>
  )
}

