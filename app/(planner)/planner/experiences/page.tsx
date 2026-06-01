import Link from 'next/link'
import { ArrowRight, Building2, CalendarDays, ClipboardList, Store, Ticket, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'

const experienceMetrics = [
  { label: 'Draft events', value: '0', detail: 'Created from planner conversations' },
  { label: 'Confirmed events', value: '0', detail: 'Venue and partner terms accepted' },
  { label: 'Ticketing syncs', value: '0', detail: 'Luma, Posh, Partiful, or Eventbrite' },
  { label: 'Booked partners', value: '0', detail: 'Venues and vendors attached to events' },
]

const eventDataSections = [
  {
    title: 'Plan artifact',
    icon: ClipboardList,
    body: 'Event type, guest target, date window, area, budget, ticketing model, and open questions.',
  },
  {
    title: 'Venue + vendor stack',
    icon: Building2,
    body: 'Accepted venue, booked vendors, deposits, partner messages, load-in notes, and timeline.',
  },
  {
    title: 'Ticketing performance',
    icon: Ticket,
    body: 'Early bird, GA, VIP, promo, comp, revenue, refunds, and check-in data once connected.',
  },
  {
    title: 'Guest operations',
    icon: Users,
    body: 'RSVP count, attendee segments, check-in staffing, reminders, and day-of readiness.',
  },
]

/**
 * Experiences workspace route for planned and confirmed events.
 */
export default function ExperiencesPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Experiences</h1>
        <p className="mt-1 text-sm text-ink-soft">Planned events, confirmed bookings, ticketing performance, and partner operations.</p>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Experience OS</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">Every event becomes an operating record</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                The page starts empty, then fills from conversations, accepted venue offers, booked vendors, ticketing syncs, and payments.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">
                Create event
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {experienceMetrics.map((metric) => (
              <div key={metric.label} className="rounded-md border border-tan bg-cream-deep/60 p-4">
                <p className="text-xs font-semibold text-ink-soft">{metric.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-ink">{metric.value}</p>
                <p className="mt-1 text-xs leading-snug text-ink-soft">{metric.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-lg border border-tan bg-cream shadow-card">
            <div className="border-b border-tan p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-clay">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">Event Pipeline</h2>
                  <p className="text-sm text-ink-soft">Draft, ready-to-book, confirmed, live, and completed events.</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-md border border-dashed border-tan bg-cream-deep/55 p-8 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-ink-soft" />
                <h3 className="mt-3 font-display text-lg font-bold text-ink">No experiences yet</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
                  Once a planner conversation reaches a coherent event plan, it will appear here with status, next action, and booked partner progress.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-clay">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">What fills in over time</h2>
                <p className="text-sm text-ink-soft">Each event record becomes more complete as users and partners act.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {eventDataSections.map((section) => {
                const Icon = section.icon

                return (
                  <div key={section.title} className="rounded-md border border-tan bg-cream-deep/55 p-4">
                    <div className="flex items-center gap-2 font-semibold text-ink">
                      <Icon className="h-4 w-4 text-clay" />
                      {section.title}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{section.body}</p>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
