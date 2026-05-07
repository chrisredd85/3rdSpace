import Link from 'next/link'
import { ArrowRight, CheckCircle2, Clock3, CreditCard, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'

const paymentMetrics = [
  { label: 'Pending approvals', value: '0', detail: 'Created from venue/vendor actions' },
  { label: 'Authorized spend', value: '$0', detail: 'Tracks approved deposits and holds' },
  { label: 'Deposits due', value: '—', detail: 'Appears after a partner accepts terms' },
  { label: 'Ledger entries', value: '0', detail: 'Synced from payments and authorizations' },
]

const paymentWorkflow = [
  'Agent recommends a venue or vendor that fits capacity, budget, and requirements.',
  'Organizer approves the action before any hold, outreach, or deposit is sent.',
  'Accepted partner terms become a payable deposit with refund and deadline details.',
  'Payment history feeds the plan ledger, profit window, and booked partner timeline.',
]

/**
 * Payments and approvals operations route for the planner shell.
 */
export default function PaymentsPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Payments & Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Authorize agent actions, track deposits, and keep spend tied to the active event plan.</p>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Payment Control Center</p>
              <h2 className="mt-2 font-display text-xl font-bold text-foreground">No money moves without organizer approval</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                This workspace is ready for approval requests, deposit deadlines, partner invoices, and platform fees as real plans move through the agent.
              </p>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link href="/planner">
                Start from plan
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {paymentMetrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-border bg-background/50 p-4">
                <p className="text-xs font-semibold text-muted-foreground">{metric.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-foreground">{metric.value}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{metric.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border bg-card/70 shadow-card">
            <div className="border-b border-border p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground">Approval Queue</h2>
                  <p className="text-sm text-muted-foreground">Venue holds, vendor outreach, and deposit payments waiting for action.</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-xl border border-dashed border-border bg-background/40 p-8 text-center">
                <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="mt-3 font-display text-lg font-bold text-foreground">No approvals pending</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Recommendation buttons create approval requests here. Once a venue or vendor accepts, the payment row will show amount, deadline, refund terms, and status.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-primary">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Payment Timeline</h2>
                <p className="text-sm text-muted-foreground">Generated from accepted partner terms.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {paymentWorkflow.map((item, index) => (
                <div key={item} className="flex gap-3 rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-border bg-card/70 p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sidebar-accent text-primary">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">Ledger</h2>
              <p className="text-sm text-muted-foreground">A structured record for deposits, authorizations, refunds, and partner payouts.</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr] gap-3 bg-muted px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Item</span>
              <span>Partner</span>
              <span>Amount</span>
              <span>Status</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-8 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              Ledger rows will populate after the first approval or deposit is created.
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
