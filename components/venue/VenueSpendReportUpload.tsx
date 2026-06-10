'use client'

import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2, FileCheck2, Loader2, ReceiptText, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ACCEPTED_SPEND_REPORT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/pdf',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  '.csv',
  '.tsv',
  '.xlsx',
  '.xls',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.heic',
].join(',')

const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/heic',
  'application/pdf',
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.xlsx', '.xls', '.pdf', '.png', '.jpg', '.jpeg', '.heic']

export type VenueSpendReportSettlement = {
  id: string
  agreement_id: string | null
  payment_id?: string | null
  status: string
  currency?: string | null
  amount_cents?: number | null
  payout_cents?: number | null
  reported_revenue_cents?: number | null
  revenue_extracted_value_cents?: number | null
  revenue_extraction_confidence?: string | null
  revenue_proof_url?: string | null
  revenue_submitted_at?: string | null
  proof_status?: string | null
  requires_manual_review?: boolean | null
}

type SpendReportSubmission = {
  extracted_value: number | null
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  calculated_owed_cents: number
  payment_id: string
  extraction_status: 'extracted' | 'needs_review'
  review_status: 'manual_review_needed' | 'ready_for_invoice_review'
  uploaded_proof: {
    filename: string
    mime_type: string
    size_bytes: number
    path: string
  } | null
}

type VenueSpendReportUploadProps = {
  settlement: VenueSpendReportSettlement
  className?: string
  onUploaded?: () => void | Promise<void>
}

export function VenueSpendReportUpload({
  settlement,
  className,
  onUploaded,
}: VenueSpendReportUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [reportedRevenue, setReportedRevenue] = useState('')
  const [submission, setSubmission] = useState<SpendReportSubmission | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const proofMeta = useMemo(() => getProofMeta(settlement), [settlement])
  const ProofIcon = proofMeta.icon
  const existingImpactCents = settlement.payout_cents ?? settlement.amount_cents ?? null
  const impactCents = submission?.calculated_owed_cents ?? existingImpactCents
  const canUpload = canSubmitSpendReport(settlement)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSubmission(null)
    if (!file) {
      setSelectedFile(null)
      return
    }

    if (!isSupportedSpendReportFile(file)) {
      setSelectedFile(null)
      setError('Unsupported file type. Upload a CSV, Excel, PDF, PNG, JPG, or HEIC report.')
      event.target.value = ''
      return
    }

    setError(null)
    setSelectedFile(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canUpload || !settlement.agreement_id || isSubmitting) return

    const parsedRevenueCents = parseDollarsToCents(reportedRevenue)
    if (reportedRevenue.trim() && parsedRevenueCents === null) {
      setError('Enter verified revenue as dollars and cents, for example 4280.00.')
      return
    }

    if (!selectedFile && parsedRevenueCents === null) {
      setError('Upload a POS report or enter verified revenue.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSubmission(null)

    try {
      const formData = new FormData()
      if (selectedFile) formData.set('image', selectedFile)
      if (parsedRevenueCents !== null) {
        formData.set('reported_revenue_cents_override', String(parsedRevenueCents))
      }

      const response = await fetch(`/api/venue/community-host-incentive/${settlement.agreement_id}/spend-report`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to submit POS proof')

      setSubmission(payload as SpendReportSubmission)
      setSelectedFile(null)
      setReportedRevenue('')
      await onUploaded?.()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to submit POS proof')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn('mt-4 rounded-lg border border-tan bg-cream/55 p-4', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', proofMeta.className)}>
            <ProofIcon className="h-3.5 w-3.5" />
            {proofMeta.label}
          </div>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{proofMeta.detail}</p>
        </div>
        <div className="rounded-md border border-tan bg-cream px-3 py-2 text-sm text-ink">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Settlement impact</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums">
            {impactCents === null ? 'Pending proof' : formatCents(impactCents, settlement.currency ?? 'usd')}
          </p>
        </div>
      </div>

      {settlement.revenue_submitted_at || settlement.revenue_proof_url || settlement.reported_revenue_cents != null ? (
        <div className="mt-3 grid gap-2 text-xs text-ink-soft sm:grid-cols-3">
          <ProofFact label="Submitted" value={settlement.revenue_submitted_at ? formatDateTime(settlement.revenue_submitted_at) : 'Not submitted'} />
          <ProofFact label="Reported revenue" value={settlement.reported_revenue_cents !== null && settlement.reported_revenue_cents !== undefined ? formatCents(settlement.reported_revenue_cents, settlement.currency ?? 'usd') : 'Needs review'} />
          <ProofFact label="Extracted confidence" value={settlement.revenue_extraction_confidence ?? 'Not extracted'} />
        </div>
      ) : null}

      {settlement.revenue_proof_url ? (
        <p className="mt-2 break-all rounded-md bg-cream px-3 py-2 text-xs text-ink-soft">
          File: {getFilenameFromPath(settlement.revenue_proof_url)}
        </p>
      ) : null}

      {canUpload ? (
        <form onSubmit={handleSubmit} className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.8fr)_auto] lg:items-end">
          <label className="block text-sm font-medium text-ink">
            Upload POS proof
            <span className="mt-2 flex min-h-20 cursor-pointer flex-col justify-center rounded-lg border border-dashed border-tan bg-cream px-3 py-3 text-sm transition-smooth hover:border-clay/50">
              <span className="inline-flex items-center gap-2 font-semibold text-ink">
                <UploadCloud className="h-4 w-4 text-clay" />
                {selectedFile ? selectedFile.name : 'Choose CSV, Excel, PDF, or image'}
              </span>
              <span className="mt-1 text-xs text-ink-soft">
                {selectedFile ? `${formatBytes(selectedFile.size)} selected` : 'Max 10 MB. Manual revenue can override extraction.'}
              </span>
            </span>
            <input
              type="file"
              accept={ACCEPTED_SPEND_REPORT_TYPES}
              className="sr-only"
              onChange={handleFileChange}
            />
          </label>

          <label className="block text-sm font-medium text-ink">
            Verified revenue
            <input
              value={reportedRevenue}
              onChange={(event) => setReportedRevenue(event.target.value)}
              inputMode="decimal"
              placeholder="4280.00"
              className="mt-2 h-10 w-full rounded-lg border border-tan bg-cream px-3 text-sm text-ink outline-none transition-smooth focus:border-clay"
            />
          </label>

          <Button type="submit" disabled={isSubmitting} className="w-full lg:w-auto">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Submit proof
          </Button>
        </form>
      ) : (
        <div className="mt-4 rounded-md border border-tan bg-cream px-3 py-2 text-sm text-ink-soft">
          Proof is locked once an invoice is sent, paid, refunded, or placed into active review.
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-ink-soft">
        POS proof updates settlement calculation only. 3rdPlace does not charge, refund, or settle funds from extracted data without invoice review or approval.
      </p>

      {submission ? (
        <div className="mt-4 rounded-lg border border-forest/25 bg-forest/10 p-3 text-sm text-forest">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {submission.extraction_status === 'extracted' ? 'Revenue extracted' : 'Manual review needed'}
              </p>
              <p className="mt-1 text-forest/90">
                Confidence: {submission.confidence}. Settlement impact: {formatCents(submission.calculated_owed_cents, settlement.currency ?? 'usd')}.
              </p>
              {submission.uploaded_proof ? (
                <p className="mt-1 text-xs text-forest/80">
                  File: {submission.uploaded_proof.filename} ({submission.uploaded_proof.mime_type}, {formatBytes(submission.uploaded_proof.size_bytes)})
                </p>
              ) : null}
              <p className="mt-1 text-xs text-forest/80">{submission.reasoning}</p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-brick/30 bg-brick/10 px-3 py-2 text-sm text-brick">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}

function ProofFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-tan bg-cream px-3 py-2">
      <p className="font-semibold uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-ink">{value}</p>
    </div>
  )
}

function getProofMeta(settlement: VenueSpendReportSettlement) {
  const status = settlement.proof_status ?? 'needed'
  if (status === 'manual_review' || settlement.requires_manual_review) {
    return {
      label: 'Manual review',
      detail: 'Extraction was low confidence or missing a usable revenue value. Admin review is needed before settlement moves forward.',
      icon: AlertCircle,
      className: 'border-brick/30 bg-brick/10 text-brick',
    }
  }
  if (status === 'submitted' || status === 'ready_for_invoice_review') {
    return {
      label: 'Proof submitted',
      detail: 'POS proof is attached. The settlement amount is available for invoice review, not automatic payment.',
      icon: FileCheck2,
      className: 'border-forest/30 bg-forest/10 text-forest',
    }
  }
  if (status === 'waiting_for_attendance') {
    return {
      label: 'Waiting for attendance',
      detail: 'Host attendance proof must stay separate and be submitted before venue POS proof can complete settlement.',
      icon: ReceiptText,
      className: 'border-tan bg-cream text-ink-soft',
    }
  }
  return {
    label: 'POS proof needed',
    detail: 'Upload the venue POS or revenue report, or enter verified revenue for the settlement calculation.',
    icon: UploadCloud,
    className: 'border-clay/30 bg-clay/10 text-clay',
  }
}

function canSubmitSpendReport(settlement: VenueSpendReportSettlement) {
  if (!settlement.agreement_id) return false
  if (!settlement.payment_id) return true
  return settlement.status === 'pending_venue_approval' || settlement.status === 'invoice_failed'
}

export function isSupportedSpendReportFile(file: File) {
  const declaredType = file.type?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (declaredType && SUPPORTED_MIME_TYPES.has(declaredType)) return true
  const lowerName = file.name.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
}

export function parseDollarsToCents(value: string) {
  const normalized = value.replace(/[$,\s]/g, '')
  if (!normalized) return null
  const match = normalized.match(/^(\d+)(?:\.(\d{0,2}))?$/)
  if (!match) return null
  const dollars = Number.parseInt(match[1], 10)
  const cents = Number.parseInt((match[2] ?? '').padEnd(2, '0') || '0', 10)
  return dollars * 100 + cents
}

function formatCents(amountCents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function getFilenameFromPath(path: string) {
  return path.split('/').pop() ?? path
}
