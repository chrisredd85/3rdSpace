'use client'

import { VenueSettingsPageShell } from '@/components/venue/VenueSettingsPageShell'
import { AmenitiesSelector } from '@/components/venue/AmenitiesSelector'

/**
 * Dedicated amenities settings page used by integration tests and owners.
 *
 * @returns Venue amenities selector page.
 */
export default function VenueAmenitiesSettingsPage() {
  return (
    <VenueSettingsPageShell
      title="Amenities"
      description="Select standard amenities and add custom venue features."
    >
      {(venueId) => <AmenitiesSelector venueId={venueId} />}
    </VenueSettingsPageShell>
  )
}

