'use client'

import { VendorProfilePage } from '@/components/builder/VendorProfilePage'

interface BuilderVendorProfileRouteProps {
  params: {
    vendorId: string
  }
}

/**
 * Builder-facing vendor profile route.
 *
 * @param props - Vendor route params.
 * @returns Vendor profile page.
 */
export default function BuilderVendorProfileRoute({ params }: BuilderVendorProfileRouteProps) {
  return <VendorProfilePage vendorId={params.vendorId} />
}
