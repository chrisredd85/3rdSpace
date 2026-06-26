'use client'

import { use } from 'react'
import { VendorProfilePage } from '@/components/builder/VendorProfilePage'

interface BuilderVendorProfileRouteProps {
  params: Promise<{
    vendorId: string
  }>
}

/**
 * Builder-facing vendor profile route.
 *
 * @param props - Vendor route params.
 * @returns Vendor profile page.
 */
export default function BuilderVendorProfileRoute({ params }: BuilderVendorProfileRouteProps) {
  const { vendorId } = use(params)
  return <VendorProfilePage vendorId={vendorId} />
}
