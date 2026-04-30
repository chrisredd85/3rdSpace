'use client'

import { DepositSettings } from '@/components/venue/DepositSettings'

interface VendorDepositSettingsProps {
  vendorId: string
  onSave?: (config: unknown) => void
}

/**
 * Vendor-specific wrapper around the shared deposit settings editor.
 *
 * @param props - Vendor id plus optional save callback.
 * @returns Deposit requirements editor for vendor owners.
 */
export function VendorDepositSettings({ vendorId, onSave }: VendorDepositSettingsProps) {
  return (
    <DepositSettings
      vendorId={vendorId}
      targetType="vendor"
      onSave={onSave}
    />
  )
}
