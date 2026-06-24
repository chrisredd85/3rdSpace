import { BarChart3, Link2, Ticket } from 'lucide-react'
import { PlannerTicketingImportSection } from '@/components/planner/PlannerTicketingImportSection'
import { PlannerTicketingConnectPanel } from '@/components/planner/PlannerTicketingConnectPanel'

/**
 * Ticketing setup and analytics route for the planner shell.
 */
export default function TicketsPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Tickets</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Connect Luma, Posh, Partiful, or Eventbrite to sync RSVPs, sales, and attendance.
        </p>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <PlannerTicketingConnectPanel mode="full" ticketed />

          <div className="rounded-lg border border-tan bg-cream p-5 shadow-card">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-brand shadow-glow">
              <Ticket className="h-6 w-6 text-cream" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold">How sync feeds the agent</h2>
            <div className="mt-4 space-y-3 text-sm text-ink-soft">
              <div className="rounded-md border border-tan bg-cream-deep/60 p-3">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <Link2 className="h-4 w-4" />
                  Publish source
                </div>
                <p className="mt-2">Attach an event URL or account connection once the plan becomes a public RSVP or ticketed event.</p>
              </div>
              <div className="rounded-md border border-tan bg-cream-deep/60 p-3">
                <div className="flex items-center gap-2 font-semibold text-ink">
                  <BarChart3 className="h-4 w-4" />
                  Performance loop
                </div>
                <p className="mt-2">RSVP rate, sell-through, check-ins, refunds, and revenue become benchmarks for future venue and vendor planning.</p>
              </div>
            </div>
          </div>
        </div>

        <PlannerTicketingImportSection className="mt-6" />
      </div>
    </div>
  )
}
