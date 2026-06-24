'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Ticket } from 'lucide-react'
import { TicketingSetupGuide } from '@/components/auth/TicketingSetupGuide'
import { cn } from '@/lib/utils'

type TicketingConnection = {
  id?: string
  platform?: string
  status?: string
}

const ticketingPlatforms = ['eventbrite', 'posh', 'luma', 'partiful']

export function PlannerTicketingSetupGuideSection({ className }: { className?: string }) {
  const [connections, setConnections] = useState<TicketingConnection[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [isOpen, setIsOpen] = useState(true)

  useEffect(() => {
    let isCurrent = true

    async function loadConnections() {
      try {
        const response = await fetch('/api/integrations/ticketing/connections', {
          cache: 'no-store',
          credentials: 'include',
        })
        const payload = await response.json().catch(() => ({}))
        if (!isCurrent) return
        setConnections(response.ok ? ((payload.connections ?? []) as TicketingConnection[]) : [])
      } catch {
        if (isCurrent) setConnections([])
      } finally {
        if (isCurrent) setIsLoaded(true)
      }
    }

    void loadConnections()

    return () => {
      isCurrent = false
    }
  }, [])

  const connectionCount = useMemo(
    () => connections.filter((connection) => Boolean(connection.platform)).length,
    [connections]
  )

  useEffect(() => {
    if (!isLoaded) return
    setIsOpen(connectionCount === 0)
  }, [connectionCount, isLoaded])

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className={cn('rounded-lg border border-tan bg-cream p-4 shadow-card', className)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-tan bg-cream-deep text-clay">
            <Ticket className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-display text-lg font-semibold text-ink">Ticketing setup guide</span>
            <span className="mt-1 block text-sm text-ink-soft">
              {connectionCount === 0
                ? 'Connect or import Eventbrite, Posh, Luma, and Partiful data before the agent uses ticket performance.'
                : `${connectionCount} ticketing connection${connectionCount === 1 ? '' : 's'} saved. Keep these setup steps as a reference.`}
            </span>
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-3">
          <span className="rounded-full border border-tan bg-cream-deep px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink-soft">
            {connectionCount === 0 ? 'Setup guide' : 'Reference'}
          </span>
          <ChevronDown className={cn('h-5 w-5 text-ink-soft transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
        </span>
      </summary>

      <TicketingSetupGuide
        selectedPlatforms={ticketingPlatforms}
        persistConnections
        className="mt-4 border-tan bg-cream-deep/70"
      />
    </details>
  )
}
