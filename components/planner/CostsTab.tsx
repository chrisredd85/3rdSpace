'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, ReceiptText, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ReceiptUploadModal } from '@/components/planner/ReceiptUploadModal'

export type CostCommitmentState = 'estimated' | 'quoted' | 'accepted' | 'invoiced' | 'paid' | 'cancelled'
export type CostCommitmentCategory = 'venue' | 'vendor' | 'staff' | 'marketing' | 'platform_fee' | 'tax' | 'other'
export type CostCommitmentConfidence = 'low' | 'medium' | 'high'

export interface CostCommitmentRow {
  id: string
  event_id: string
  plan_id: string | null
  org_id: string
  category: CostCommitmentCategory
  party_id: string | null
  party_name: string | null
  description: string | null
  amount_cents: number
  currency: string
  state: CostCommitmentState
  confidence: CostCommitmentConfidence
  evidence_url: string | null
  evidence_signed_url: string | null
  evidence_type: 'contract' | 'invoice' | 'receipt' | 'screenshot' | 'none'
  source: 'manual' | 'outreach_reply' | 'receipt_upload' | 'csv_import' | 'webhook'
  metadata: Record<string, unknown>
  committed_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

interface CostsTabProps {
  eventId: string
}

interface CommitmentsResponse {
  commitments?: CostCommitmentRow[]
  error?: string
}

const stateOrder: CostCommitmentState[] = ['estimated', 'quoted', 'accepted', 'invoiced', 'paid', 'cancelled']

const stateLabels: Record<CostCommitmentState, string> = {
  estimated: 'Estimated',
  quoted: 'Quoted',
  accepted: 'Accepted',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

const categoryLabels: Record<CostCommitmentCategory, string> = {
  venue: 'Venue',
  vendor: 'Vendor',
  staff: 'Staff',
  marketing: 'Marketing',
  platform_fee: 'Platform fee',
  tax: 'Tax',
  other: 'Other',
}

export function CostsTab({ eventId }: CostsTabProps) {
  const [commitments, setCommitments] = useState<CostCommitmentRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [uploadingCommitmentId, setUploadingCommitmentId] = useState<string | null>(null)

  const loadCommitments = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/${eventId}/commitments`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as CommitmentsResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load costs')
      setCommitments(payload.commitments ?? [])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load costs')
    } finally {
      setIsLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    void loadCommitments()
  }, [loadCommitments])

  const totals = useMemo(() => {
    return commitments.reduce(
      (summary, commitment) => {
        if (commitment.state === 'cancelled') return summary
        if (commitment.state === 'estimated' || commitment.state === 'quoted') {
          summary.estimated += commitment.amount_cents
        }
        if (commitment.state === 'accepted' || commitment.state === 'invoiced' || commitment.state === 'paid') {
          summary.committed += commitment.amount_cents
        }
        if (commitment.state === 'paid') {
          summary.paid += commitment.amount_cents
        }
        return summary
      },
      { estimated: 0, committed: 0, paid: 0 }
    )
  }, [commitments])

  const grouped = useMemo(() => {
    return stateOrder.map((state) => ({
      state,
      rows: commitments.filter((commitment) => commitment.state === state),
    })).filter((group) => group.rows.length > 0)
  }, [commitments])

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <TotalTile label="Estimated" value={totals.estimated} />
        <TotalTile label="Committed" value={totals.committed} tone="committed" />
        <TotalTile label="Paid" value={totals.paid} tone="paid" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground">
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Commitments</h2>
            <p className="text-sm text-muted-foreground">{commitments.length} tracked cost rows</p>
          </div>
        </div>
        <Button type="button" onClick={() => setUploadingCommitmentId('')}>
          <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
          Upload receipt
        </Button>
      </div>

      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center rounded-md border border-border bg-card/50 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading costs
        </div>
      ) : commitments.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-5 py-10 text-center">
          <p className="font-medium text-foreground">No costs recorded yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Upload a receipt or wait for accepted outreach replies to create commitments.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.state} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {stateLabels[group.state]}
                </h3>
                <span className="text-sm font-medium text-foreground">
                  {formatCents(group.rows.reduce((sum, row) => sum + row.amount_cents, 0))}
                </span>
              </div>
              <div className="overflow-hidden rounded-md border border-border bg-card">
                {group.rows.map((commitment, index) => (
                  <CommitmentRow
                    key={commitment.id}
                    commitment={commitment}
                    isLast={index === group.rows.length - 1}
                    onUpload={() => setUploadingCommitmentId(commitment.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {uploadingCommitmentId !== null ? (
        <ReceiptUploadModal
          eventId={eventId}
          commitments={commitments}
          initialCommitmentId={uploadingCommitmentId || null}
          onClose={() => setUploadingCommitmentId(null)}
          onConfirmed={async () => {
            setUploadingCommitmentId(null)
            await loadCommitments()
          }}
        />
      ) : null}
    </div>
  )
}

function TotalTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'committed' | 'paid'
}) {
  return (
    <div className={cn(
      'rounded-md border bg-card px-4 py-4',
      tone === 'committed' ? 'border-primary/30' : 'border-border',
      tone === 'paid' ? 'border-emerald-700/30' : ''
    )}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{formatCents(value)}</p>
    </div>
  )
}

function CommitmentRow({
  commitment,
  isLast,
  onUpload,
}: {
  commitment: CostCommitmentRow
  isLast: boolean
  onUpload: () => void
}) {
  return (
    <div className={cn('grid gap-3 px-4 py-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_auto]', !isLast && 'border-b border-border')}>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{commitment.party_name ?? commitment.description ?? 'Unassigned cost'}</p>
        <p className="mt-1 text-sm text-muted-foreground">{categoryLabels[commitment.category]}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Amount</p>
        <p className="mt-1 font-medium text-foreground">{formatCents(commitment.amount_cents)}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Confidence</p>
        <p className="mt-1 capitalize text-foreground">{commitment.confidence}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Evidence</p>
        {commitment.evidence_signed_url ? (
          <a
            href={commitment.evidence_signed_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">None</p>
        )}
      </div>
      <div className="flex items-center justify-start lg:justify-end">
        {commitment.state === 'paid' ? (
          <span className="inline-flex items-center rounded-full border border-emerald-700/30 px-3 py-1 text-sm font-medium text-emerald-800">
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Paid
          </span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onUpload}>
            <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
            Receipt
          </Button>
        )}
      </div>
    </div>
  )
}

export function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
