import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type WebhookRow = {
  id: string
  stripe_event_id: string
  event_type: string
  source?: string | null
  processing_outcome?: string | null
  processed?: boolean | null
  duplicate_count?: number | null
  last_error?: string | null
  received_at?: string | null
  created_at?: string | null
}

type AccountRow = {
  stripe_account_id: string | null
  account_status: string | null
  charges_enabled: boolean | null
  payouts_enabled: boolean | null
  last_webhook_event_type?: string | null
  last_webhook_at?: string | null
}

export default async function AdminStripeHealthPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const [webhooks, vendorAccounts, venueAccounts, builderAccounts] = await Promise.all([
    admin
      .from('stripe_webhook_events')
      .select('id, stripe_event_id, event_type, source, processing_outcome, processed, duplicate_count, last_error, received_at, created_at')
      .order('received_at', { ascending: false })
      .limit(50),
    admin
      .from('vendor_stripe_accounts')
      .select('stripe_account_id, account_status, charges_enabled, payouts_enabled, last_webhook_event_type, last_webhook_at')
      .order('updated_at', { ascending: false })
      .limit(20),
    admin
      .from('venue_stripe_accounts')
      .select('stripe_account_id, account_status, charges_enabled, payouts_enabled, last_webhook_event_type, last_webhook_at')
      .order('updated_at', { ascending: false })
      .limit(20),
    admin
      .from('builder_stripe_accounts')
      .select('stripe_account_id, account_status, charges_enabled, payouts_enabled, last_webhook_event_type, last_webhook_at')
      .order('updated_at', { ascending: false })
      .limit(20),
  ])

  const webhookRows = (webhooks.data ?? []) as WebhookRow[]
  const accountRows = [
    ...tagAccounts('Vendor', vendorAccounts.data),
    ...tagAccounts('Venue', venueAccounts.data),
    ...tagAccounts('Builder', builderAccounts.data),
  ]

  const failedCount = webhookRows.filter((row) => row.processing_outcome === 'failed' || row.processed === false).length
  const duplicateCount = webhookRows.reduce((sum, row) => sum + Number(row.duplicate_count ?? 0), 0)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Stripe health</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Webhook ledger, duplicate deliveries, and connected-account readiness.
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Recent deliveries" value={webhookRows.length} />
          <Metric label="Failed or open" value={failedCount} />
          <Metric label="Duplicate deliveries" value={duplicateCount} />
          <Metric label="Connected accounts" value={accountRows.length} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-lg font-semibold">Recent webhook deliveries</h2>
            <div className="mt-4 divide-y divide-border">
              {webhookRows.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No Stripe webhook deliveries recorded.</p>
              ) : webhookRows.map((row) => (
                <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold">{row.event_type}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{row.source ?? 'platform'} · {row.stripe_event_id}</p>
                    {row.last_error ? <p className="mt-1 text-xs text-destructive">{row.last_error}</p> : null}
                  </div>
                  <div className="text-left md:text-right">
                    <p className="font-mono text-xs">{row.processing_outcome ?? (row.processed ? 'processed' : 'received')}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.received_at ?? row.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-display text-lg font-semibold">Connected account state</h2>
            <div className="mt-4 space-y-3">
              {accountRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No connected accounts found.</p>
              ) : accountRows.map((row, index) => (
                <div key={`${row.kind}-${row.stripe_account_id ?? index}`} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{row.kind}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{row.stripe_account_id ?? 'No account id'}</p>
                    </div>
                    <span className="rounded-full border border-border px-2 py-1 text-xs">{row.account_status ?? 'unknown'}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Charges {row.charges_enabled ? 'enabled' : 'off'} · Payouts {row.payouts_enabled ? 'enabled' : 'off'}
                  </p>
                  {row.last_webhook_event_type ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last webhook: {row.last_webhook_event_type} · {formatDate(row.last_webhook_at)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
    </div>
  )
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}

function tagAccounts(kind: string, rows: AccountRow[] | null | undefined) {
  return ((rows ?? []) as AccountRow[]).map((row) => ({ ...row, kind }))
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}
