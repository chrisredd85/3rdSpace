'use client'

import Link from 'next/link'
import { VendorSearchPage } from '@/components/builder/VendorSearchPage'

/**
 * Vendor catalog route within the planner shell.
 */
export default function VendorMarketplacePage() {
  return (
    <div className="space-y-4 px-6 py-6">
      <Link href="/planner/vendors" className="text-sm font-medium text-muted-foreground hover:text-foreground">
        ← Vendors
      </Link>
      <VendorSearchPage />
    </div>
  )
}
