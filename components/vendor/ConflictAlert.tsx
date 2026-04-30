'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

interface ConflictAlertProps {
  vendorId?: string | null
  date?: string | null
  compact?: boolean
  onConflictChange?: (hasConflict: boolean) => void
}

interface ConflictResponse {
  hasConflict?: boolean
  status?: string
  error?: string
}

/**
 * Warns when a selected vendor date is blocked, booked, or otherwise unavailable.
 *
 * @param props - Vendor/date pair plus optional conflict callback.
 * @returns Conflict status alert.
 */
export function ConflictAlert({ vendorId, date, compact = false, onConflictChange }: ConflictAlertProps) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    /**
     * Loads date conflict status from the API.
     */
    async function loadConflict() {
      if (!vendorId || !date) {
        setStatus(null)
        setHasConflict(false)
        onConflictChange?.(false)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/vendor/conflicts?vendorId=${vendorId}&date=${date}`)
        const data = (await response.json()) as ConflictResponse

        if (!response.ok) throw new Error(data.error || 'Unable to check vendor availability')
        if (!isMounted) return

        const conflict = Boolean(data.hasConflict)
        setHasConflict(conflict)
        setStatus(data.status || 'available')
        onConflictChange?.(conflict)
      } catch (loadError) {
        if (!isMounted) return
        setError(loadError instanceof Error ? loadError.message : 'Unable to check vendor availability')
        setHasConflict(false)
        onConflictChange?.(false)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadConflict()

    return () => {
      isMounted = false
    }
  }, [vendorId, date, onConflictChange])

  if (!vendorId || !date) return null

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-background p-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking vendor availability...
      </div>
    )
  }

  if (error) {
    return <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
  }

  if (hasConflict) {
    return (
      <div className={`flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 ${compact ? 'p-2 text-xs' : 'p-3 text-sm'} text-destructive`}>
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>This vendor is {status} on {date}. Choose another date before booking.</span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 ${compact ? 'p-2 text-xs' : 'p-3 text-sm'} text-primary`}>
      <CheckCircle2 className="h-4 w-4" />
      Vendor is {status || 'available'} on {date}.
    </div>
  )
}

