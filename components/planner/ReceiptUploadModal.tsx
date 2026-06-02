'use client'

import { FormEvent, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, ReceiptText, UploadCloud, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CostCommitmentCategory, CostCommitmentRow } from '@/components/planner/CostsTab'

interface ReceiptUploadModalProps {
  eventId: string
  commitments: CostCommitmentRow[]
  initialCommitmentId: string | null
  onClose: () => void
  onConfirmed: () => void | Promise<void>
}

interface ReceiptUploadResponse {
  receipt?: {
    path: string
    signed_url: string
    filename: string
  }
  extraction?: {
    vendor_or_payee: string
    amount_cents: number | null
    paid_at: string | null
    payment_method: string | null
    confidence: 'low' | 'medium' | 'high'
    raw_ocr_text: string
  }
  suggested_commitments?: Array<{
    id: string
    party_name: string | null
    amount_cents: number
    state: string
    score: number
  }>
  error?: string
}

const categoryOptions: Array<{ value: CostCommitmentCategory; label: string }> = [
  { value: 'venue', label: 'Venue' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'staff', label: 'Staff' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'platform_fee', label: 'Platform fee' },
  { value: 'tax', label: 'Tax' },
  { value: 'other', label: 'Other' },
]

export function ReceiptUploadModal({
  eventId,
  commitments,
  initialCommitmentId,
  onClose,
  onConfirmed,
}: ReceiptUploadModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<ReceiptUploadResponse | null>(null)
  const [selectedCommitmentId, setSelectedCommitmentId] = useState(initialCommitmentId ?? '')
  const [vendorName, setVendorName] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [newCategory, setNewCategory] = useState<CostCommitmentCategory>('other')
  const [isUploading, setIsUploading] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const suggestedIds = useMemo(() => new Set((uploadResult?.suggested_commitments ?? []).map((match) => match.id)), [uploadResult])
  const selectOptions = useMemo(() => {
    const suggested = (uploadResult?.suggested_commitments ?? [])
      .map((match) => commitments.find((commitment) => commitment.id === match.id))
      .filter((commitment): commitment is CostCommitmentRow => Boolean(commitment))
    const remaining = commitments.filter((commitment) => !suggestedIds.has(commitment.id))
    return [...suggested, ...remaining]
  }, [commitments, suggestedIds, uploadResult])

  async function handleUpload(event: FormEvent) {
    event.preventDefault()
    if (!file) {
      setErrorMessage('Choose a receipt first.')
      return
    }

    setIsUploading(true)
    setErrorMessage(null)
    try {
      const formData = new FormData()
      formData.set('file', file)
      if (selectedCommitmentId && selectedCommitmentId !== 'new') {
        formData.set('commitment_id', selectedCommitmentId)
      }

      const response = await fetch(`/api/planner/events/${eventId}/receipts`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as ReceiptUploadResponse
      if (!response.ok) throw new Error(payload.error ?? 'Unable to upload receipt')

      setUploadResult(payload)
      const extraction = payload.extraction
      setVendorName(extraction?.vendor_or_payee ?? '')
      setAmountInput(extraction?.amount_cents !== null && extraction?.amount_cents !== undefined
        ? centsToDollarsInput(extraction.amount_cents)
        : '')
      setPaidAt(extraction?.paid_at ? extraction.paid_at.slice(0, 10) : '')
      setPaymentMethod(extraction?.payment_method ?? '')
      setSelectedCommitmentId(selectedCommitmentId || payload.suggested_commitments?.[0]?.id || '')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to upload receipt')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleConfirm() {
    if (!uploadResult?.receipt) return
    const amountCents = dollarsInputToCents(amountInput)
    if (amountCents === null) {
      setErrorMessage('Enter a paid amount.')
      return
    }

    setIsConfirming(true)
    setErrorMessage(null)
    try {
      const extractionMetadata = {
        receipt_filename: uploadResult.receipt.filename,
        receipt_extraction: uploadResult.extraction ?? null,
        payment_method: paymentMethod || null,
      }

      if (selectedCommitmentId === 'new' || !selectedCommitmentId) {
        const response = await fetch(`/api/planner/events/${eventId}/commitments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: newCategory,
            party_name: vendorName || 'Receipt cost',
            amount_cents: amountCents,
            state: 'paid',
            confidence: uploadResult.extraction?.confidence ?? 'low',
            source: 'receipt_upload',
            evidence_url: uploadResult.receipt.path,
            evidence_type: 'receipt',
            paid_at: paidAt || new Date().toISOString(),
            metadata: extractionMetadata,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error ?? 'Unable to create paid commitment')
      } else {
        const existing = commitments.find((commitment) => commitment.id === selectedCommitmentId)
        const response = await fetch(`/api/planner/events/${eventId}/commitments/${selectedCommitmentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_cents: amountCents,
            state: 'paid',
            paid_at: paidAt || new Date().toISOString(),
            evidence_url: uploadResult.receipt.path,
            evidence_type: 'receipt',
            confidence: uploadResult.extraction?.confidence ?? existing?.confidence ?? 'low',
            metadata: {
              ...(existing?.metadata ?? {}),
              ...extractionMetadata,
            },
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error ?? 'Unable to mark commitment paid')
      }

      await onConfirmed()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to confirm receipt')
    } finally {
      setIsConfirming(false)
    }
  }

  const extractionConfidence = uploadResult?.extraction?.confidence

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-md border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">Receipt</h2>
              <p className="text-sm text-muted-foreground">Match proof to a cost row</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground"
            aria-label="Close receipt upload"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {errorMessage ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {errorMessage}
            </div>
          ) : null}

          <form className="grid gap-4 sm:grid-cols-[1fr_auto]" onSubmit={handleUpload}>
            <div className="space-y-2">
              <Label htmlFor="receipt-file">File</Label>
              <Input
                id="receipt-file"
                type="file"
                accept="image/png,image/jpeg,image/heic,application/pdf"
                onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isUploading}>
                {isUploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Extract
              </Button>
            </div>
          </form>

          {uploadResult?.receipt ? (
            <div className="space-y-5">
              <div className={cn(
                'rounded-md border px-4 py-3 text-sm',
                extractionConfidence === 'low' ? 'border-amber-600/30 bg-amber-50 text-amber-900' : 'border-border bg-card text-foreground'
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Extraction confidence: {extractionConfidence ?? 'low'}</span>
                  <a href={uploadResult.receipt.signed_url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                    View receipt
                  </a>
                </div>
                {extractionConfidence === 'low' && uploadResult.extraction?.raw_ocr_text ? (
                  <p className="mt-2 text-xs">{uploadResult.extraction.raw_ocr_text}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="receipt-vendor">Payee</Label>
                  <Input id="receipt-vendor" value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receipt-amount">Amount</Label>
                  <Input id="receipt-amount" inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receipt-paid-at">Paid date</Label>
                  <Input id="receipt-paid-at" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receipt-payment-method">Payment method</Label>
                  <Input id="receipt-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="receipt-match">Cost row</Label>
                <select
                  id="receipt-match"
                  value={selectedCommitmentId || 'new'}
                  onChange={(event) => setSelectedCommitmentId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="new">Create new commitment from receipt</option>
                  {selectOptions.map((commitment) => (
                    <option key={commitment.id} value={commitment.id}>
                      {commitment.party_name ?? commitment.description ?? 'Unassigned'} · {formatCents(commitment.amount_cents)}
                    </option>
                  ))}
                </select>
              </div>

              {(selectedCommitmentId === 'new' || !selectedCommitmentId) ? (
                <div className="space-y-2">
                  <Label htmlFor="receipt-category">Category</Label>
                  <select
                    id="receipt-category"
                    value={newCategory}
                    onChange={(event) => setNewCategory(event.target.value as CostCommitmentCategory)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                <Button type="button" onClick={handleConfirm} disabled={isConfirming}>
                  {isConfirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Confirm
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function centsToDollarsInput(value: number) {
  return (value / 100).toFixed(2).replace(/\.00$/, '')
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function dollarsInputToCents(value: string) {
  const normalized = value.replace(/[$,\s]/g, '')
  if (!normalized) return null
  const dollars = Number(normalized)
  if (!Number.isFinite(dollars) || dollars < 0) return null
  return Math.round(dollars * 100)
}
