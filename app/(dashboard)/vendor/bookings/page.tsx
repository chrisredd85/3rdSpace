'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { VendorBookingsDashboard } from '@/components/vendor/VendorBookingsDashboard'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'

/**
 * Vendor booking dashboard page.
 *
 * @returns Vendor booking dashboard for the signed-in vendor owner.
 */
export default function VendorBookingsPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [loadingVendor, setLoadingVendor] = useState(true)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads the vendor profile owned by the signed-in user.
     */
    async function loadVendor() {
      if (!user?.id) {
        setLoadingVendor(false)
        return
      }

      setLoadingVendor(true)
      const { data, error } = await supabase
        .from('vendor_profiles')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)

      if (!isMounted) return

      if (error) {
        console.error('[VendorBookingsPage] Failed to load vendor profile', error)
        setVendorId(null)
      } else {
        setVendorId(data?.[0]?.id ?? null)
      }

      setLoadingVendor(false)
    }

    loadVendor()

    return () => {
      isMounted = false
    }
  }, [user?.id])

  if (isUserLoading || loadingVendor) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-ink-soft">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading booking dashboard...
      </div>
    )
  }

  if (userError || !user) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-brick">Please log in to continue.</CardContent>
      </Card>
    )
  }

  if (!vendorId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-ink-soft">No vendor profile found.</CardContent>
      </Card>
    )
  }

  return <VendorBookingsDashboard vendorId={vendorId} />
}
