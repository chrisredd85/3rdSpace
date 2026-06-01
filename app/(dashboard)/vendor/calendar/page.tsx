'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { VendorCalendar } from '@/components/vendor/VendorCalendar'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'

/**
 * Vendor availability calendar page.
 *
 * @returns Calendar page for manual availability management.
 */
export default function VendorCalendarPage() {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [loadingVendor, setLoadingVendor] = useState(true)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads the signed-in user's vendor profile.
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
        console.error('[VendorCalendarPage] Failed to load vendor', error)
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
        Loading calendar...
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-ink">Availability Calendar</h1>
        <p className="mt-1 text-ink-soft">Click dates to block, hold, or reopen availability.</p>
      </div>
      <VendorCalendar vendorId={vendorId} />
    </div>
  )
}
