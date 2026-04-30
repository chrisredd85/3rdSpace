'use client'

import { VenueSettingsPageShell } from '@/components/venue/VenueSettingsPageShell'
import { BulkApprovalDashboard } from '@/components/venue/BulkApprovalDashboard'
import { BulkApprovalSettings } from '@/components/venue/BulkApprovalSettings'

/**
 * Dedicated bulk approval settings and dashboard page.
 *
 * @returns Bulk approval settings and pending booking dashboard.
 */
export default function VenueBulkApprovalSettingsPage() {
  return (
    <VenueSettingsPageShell
      title="Bulk Approval"
      description="Configure auto-approval rules and process pending booking requests in batches."
    >
      {(venueId) => (
        <div className="space-y-8">
          <BulkApprovalSettings venueId={venueId} />
          <BulkApprovalDashboard venueId={venueId} />
        </div>
      )}
    </VenueSettingsPageShell>
  )
}

