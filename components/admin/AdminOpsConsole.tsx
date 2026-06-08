'use client'

import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CreditCard, RefreshCw, ShieldCheck, Store, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'

type OpsData = {
  generatedAt: string
  summary: Record<string, number>
  jobs: Array<Record<string, any>>
  integrations: Array<Record<string, any>>
  ticketingConnections: Array<Record<string, any>>
  webhookEvents: Array<Record<string, any>>
  disputes: Array<Record<string, any>>
  refundBookings: Array<Record<string, any>>
  marketplace: {
    pendingVendorBookings: Array<Record<string, any>>
    pendingVenueBookings: Array<Record<string, any>>
    unpublishedVenues: Array<Record<string, any>>
  }
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return 'Not yet'
  return new Date(value).toLocaleString()
}

function StatusPill({ value }: { value: unknown }) {
  const label = typeof value === 'string' && value ? value : 'unknown'
  const tone =
    ['failed', 'dead', 'cancelled', 'escalated'].includes(label)
      ? 'border-red-500/30 bg-red-500/10 text-red-200'
      : ['pending', 'running', 'syncing', 'under_review'].includes(label)
        ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
        : 'border-primary/30 bg-primary/10 text-primary'

  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon: typeof Activity
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-3 font-display text-3xl font-bold text-foreground">{value}</p>
    </div>
  )
}

function OpsTable({
  title,
  rows,
  columns,
}: {
  title: string
  rows: Array<Record<string, any>>
  columns: Array<{ key: string; label: string; type?: 'status' | 'date' | 'error' }>
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-4 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
        <span className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
          {rows.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              {columns.map((column) => (
                <th key={column.key} className="pb-2 pr-4 font-semibold">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={columns.length}>No records</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={String(row.id ?? index)} className="text-foreground">
                  {columns.map((column) => {
                    const value = row[column.key]
                    return (
                      <td key={column.key} className="max-w-[280px] truncate py-3 pr-4">
                        {column.type === 'status' ? <StatusPill value={value} /> : null}
                        {column.type === 'date' ? formatDate(value) : null}
                        {column.type === 'error' ? (
                          <span className={value ? 'text-red-200' : 'text-muted-foreground'}>{value || 'None'}</span>
                        ) : null}
                        {!column.type ? String(value ?? '—') : null}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function AdminOpsConsole({ initialData }: { initialData: OpsData }) {
  const [data, setData] = useState(initialData)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRunningJobs, setIsRunningJobs] = useState(false)

  const marketplaceRows = useMemo(
    () => [
      ...data.marketplace.pendingVendorBookings.map((row) => ({ ...row, queue: 'Vendor booking' })),
      ...data.marketplace.pendingVenueBookings.map((row) => ({ ...row, queue: 'Venue booking' })),
      ...data.marketplace.unpublishedVenues.map((row) => ({ ...row, queue: 'Unpublished venue', status: 'review' })),
    ],
    [data.marketplace.pendingVendorBookings, data.marketplace.pendingVenueBookings, data.marketplace.unpublishedVenues]
  )

  async function refresh() {
    setIsRefreshing(true)
    try {
      const response = await fetch('/api/admin/ops', { credentials: 'include' })
      const nextData = await response.json()
      if (response.ok) setData(nextData)
    } finally {
      setIsRefreshing(false)
    }
  }

  async function runJobs() {
    setIsRunningJobs(true)
    try {
      await fetch('/api/internal/jobs/run?limit=10', {
        method: 'POST',
        credentials: 'include',
      })
      await refresh()
    } finally {
      setIsRunningJobs(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="font-display text-4xl font-bold">Operations console</h1>
            <p className="mt-2 text-sm text-muted-foreground">Disputes, refunds, integration health, jobs, and catalog queues.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button type="button" variant="hero" onClick={runJobs} disabled={isRunningJobs}>
              <Activity className="mr-2 h-4 w-4" />
              {isRunningJobs ? 'Running...' : 'Run jobs'}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Queued jobs" value={data.summary.queuedJobs || 0} icon={Activity} />
          <MetricCard label="Integration issues" value={data.summary.integrationErrors || 0} icon={AlertTriangle} />
          <MetricCard label="Open disputes" value={data.summary.openDisputes || 0} icon={ShieldCheck} />
          <MetricCard label="Refund cases" value={data.summary.refundCases || 0} icon={CreditCard} />
          <MetricCard label="Webhook issues" value={data.summary.webhookErrors || 0} icon={Webhook} />
          <MetricCard label="Vendor requests" value={data.summary.pendingVendorBookings || 0} icon={Store} />
          <MetricCard label="Venue requests" value={data.summary.pendingVenueBookings || 0} icon={Store} />
          <MetricCard label="Venue reviews" value={data.summary.unpublishedVenues || 0} icon={Store} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <OpsTable
            title="Background jobs"
            rows={data.jobs}
            columns={[
              { key: 'job_type', label: 'Type' },
              { key: 'status', label: 'Status', type: 'status' },
              { key: 'attempts', label: 'Attempts' },
              { key: 'error', label: 'Error', type: 'error' },
              { key: 'created_at', label: 'Created', type: 'date' },
            ]}
          />
          <OpsTable
            title="Integration health"
            rows={[...data.ticketingConnections, ...data.integrations]}
            columns={[
              { key: 'platform', label: 'Platform' },
              { key: 'status', label: 'Account', type: 'status' },
              { key: 'sync_status', label: 'Event', type: 'status' },
              { key: 'last_error', label: 'Error', type: 'error' },
              { key: 'updated_at', label: 'Updated', type: 'date' },
            ]}
          />
          <OpsTable
            title="Webhook deliveries"
            rows={data.webhookEvents}
            columns={[
              { key: 'platform', label: 'Platform' },
              { key: 'webhook_type', label: 'Type' },
              { key: 'processing_error', label: 'Error', type: 'error' },
              { key: 'processed_at', label: 'Processed', type: 'date' },
              { key: 'created_at', label: 'Received', type: 'date' },
            ]}
          />
          <OpsTable
            title="Disputes"
            rows={data.disputes}
            columns={[
              { key: 'dispute_type', label: 'Type' },
              { key: 'status', label: 'Status', type: 'status' },
              { key: 'agreement_id', label: 'Agreement' },
              { key: 'created_at', label: 'Created', type: 'date' },
            ]}
          />
          <OpsTable
            title="Refunds"
            rows={data.refundBookings}
            columns={[
              { key: 'status', label: 'Booking', type: 'status' },
              { key: 'payment_status', label: 'Payment', type: 'status' },
              { key: 'refund_amount', label: 'Refund' },
              { key: 'cancellation_reason', label: 'Reason' },
              { key: 'created_at', label: 'Created', type: 'date' },
            ]}
          />
          <OpsTable
            title="Marketplace ops"
            rows={marketplaceRows}
            columns={[
              { key: 'queue', label: 'Queue' },
              { key: 'status', label: 'Status', type: 'status' },
              { key: 'id', label: 'Record' },
              { key: 'created_at', label: 'Created', type: 'date' },
            ]}
          />
        </div>
        <p className="text-xs text-muted-foreground">Last refreshed {formatDate(data.generatedAt)}</p>
      </div>
    </div>
  )
}
