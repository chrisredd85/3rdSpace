'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Building2, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'

interface VenueSettingsPageShellProps {
  title: string
  description: string
  children: (venueId: string) => ReactNode
}

/**
 * Loads the signed-in venue owner's first venue and renders a settings panel.
 *
 * @param props - Page title, description, and render callback that receives a venue id.
 * @returns Shared settings page shell for venue feature editors.
 */
export function VenueSettingsPageShell({ title, description, children }: VenueSettingsPageShellProps) {
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [venueId, setVenueId] = useState<string | null>(null)
  const [loadingVenue, setLoadingVenue] = useState(true)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads the first venue owned by the current user.
     */
    async function loadOwnedVenue() {
      if (!user) {
        setLoadingVenue(false)
        return
      }

      setLoadingVenue(true)
      const { data, error } = await supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)

      if (!isMounted) return

      if (error) {
        console.error('[VenueSettingsPageShell] Failed to load venue', error)
        setVenueId(null)
      } else {
        setVenueId(data?.[0]?.id ?? null)
      }

      setLoadingVenue(false)
    }

    loadOwnedVenue()

    return () => {
      isMounted = false
    }
  }, [user])

  if (isUserLoading || loadingVenue) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading venue settings...
        </div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-destructive">
          Please log in as a venue owner to manage these settings.
        </CardContent>
      </Card>
    )
  }

  if (!venueId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Building2 className="mb-4 h-10 w-10 text-muted-foreground/60" />
          <p className="font-semibold text-foreground">No venue found</p>
          <p className="mt-1 text-sm text-muted-foreground">Create a venue listing before configuring owner features.</p>
          <Button asChild className="mt-4">
            <Link href="/venue/listing">Go to listing</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
          <Link href="/venue">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Venue dashboard
          </Link>
        </Button>
        <h1 className="text-3xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardContent className="p-6">{children(venueId)}</CardContent>
      </Card>
    </div>
  )
}

