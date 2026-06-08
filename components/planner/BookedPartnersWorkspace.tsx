'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Loader2,
  MapPinned,
  MessageSquare,
  RotateCcw,
  Send,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { VenueRentalPaymentButton } from '@/components/planner/VenueRentalPaymentButton'
import { centsToDollars, dollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface BookedPartnerMessage {
  id: string
  sender: 'organizer' | 'host' | 'partner' | 'agent' | 'concierge'
  author: string
  text: string
  time: string
}

export interface BookedPartnerTimelineItem {
  id: string
  label: string
  date: string
  status: 'done' | 'due' | 'upcoming'
  detail: string
}

export interface BookedPartnerDocument {
  id: string
  kind: 'contract' | 'coi' | 'invoice' | 'receipt'
  label: string
  url: string
  signedAt: string | null
}

export interface BookedPartnerVenueRental {
  venue_booking: {
    id: string
    status: string | null
    amount_cents: number
  } | null
  transaction: {
    id: string
    status: string
    amount_cents: number
    processing_fee_cents: number
    refund_amount_cents: number | null
    refund_reason: string | null
    paid_at: string | null
    refund_requested_at: string | null
    refund_approved_at: string | null
    stripe_transfer_id: string | null
  } | null
}

export interface BookedPartner {
  id: string
  threadId?: string
  name: string
  category: string
  status: string
  depositLabel: string
  depositCents?: number | null
  nextStep: string
  contactName: string
  messages: BookedPartnerMessage[]
  timeline: BookedPartnerTimelineItem[]
  documents?: BookedPartnerDocument[]
  venueRental?: BookedPartnerVenueRental | null
  logistics?: {
    loadInTime?: string | null
    contactName?: string | null
    address?: string | null
    parkingNotes?: string | null
  }
}

interface BookedPartnersWorkspaceProps {
  title: string
  description: string
  emptyMessage: string
  partners?: BookedPartner[]
  partnerKind?: 'venue' | 'vendor'
  planId?: string | null
}

interface PartnershipWorkspaceResponse {
  workspaces?: PartnershipWorkspacePayload[]
  error?: string
}

interface PartnershipWorkspacePayload {
  thread: {
    id: string
    status: string
    partner_kind: 'venue' | 'vendor'
  }
  partner: {
    id: string
    name: string
    category: string
  }
  messages: Array<{
    id: string
    sender_kind: 'host' | 'partner' | 'agent' | 'concierge'
    body: string
    created_at: string
  }>
  milestones: Array<{
    id: string
    label: string
    due_date: string | null
    completed_at: string | null
  }>
  documents: Array<{
    id: string
    kind: 'contract' | 'coi' | 'invoice' | 'receipt'
    url: string
    signed_at: string | null
    created_at: string
  }>
  logistics: {
    load_in_time: string | null
    contact_name: string | null
    address: string | null
    parking_notes: string | null
  }
  payment_status: {
    label: string
    deposit_cents: number | null
    is_deposit_paid: boolean
  }
  venue_rental?: BookedPartnerVenueRental | null
  next_required_action: string
}

/**
 * Booked partner operations surface for accepted venue/vendor relationships.
 *
 * Loads real partner workspaces from the planner API when a plan id is available.
 * The workspace remains hidden until an opportunity invite is accepted and the
 * deposit step is unblocked by the partner response flow.
 */
export function BookedPartnersWorkspace({
  title,
  description,
  partners,
  partnerKind,
  planId,
}: BookedPartnersWorkspaceProps) {
  const [resolvedPlanId, setResolvedPlanId] = useState<string | null>(planId ?? null)
  const [remotePartners, setRemotePartners] = useState<BookedPartner[]>([])
  const [selectedPartnerId, setSelectedPartnerId] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [localMessagesByPartner, setLocalMessagesByPartner] = useState<Record<string, BookedPartnerMessage[]>>({})
  const [, setIsLoading] = useState(false)
  const [isMutating, setIsMutating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [refundPartner, setRefundPartner] = useState<BookedPartner | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false)

  useEffect(() => {
    setResolvedPlanId(planId ?? readLivePlanId())
  }, [planId])

  useEffect(() => {
    if (!partnerKind || !resolvedPlanId || resolvedPlanId.startsWith('mock-plan-')) return

    let isCancelled = false
    async function loadWorkspaces() {
      setIsLoading(true)
      setErrorMessage(null)

      try {
        const response = await fetch(`/api/planner/plans/${resolvedPlanId}/partnerships?kind=${partnerKind}`)
        const payload = (await response.json()) as PartnershipWorkspaceResponse

        if (response.status === 401 || response.status === 403 || response.status === 404) {
          if (!isCancelled) setRemotePartners([])
          return
        }

        if (!response.ok) throw new Error(payload.error || 'Unable to load booked partners')
        if (!isCancelled) setRemotePartners((payload.workspaces ?? []).map(mapWorkspaceToPartner))
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load booked partners')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void loadWorkspaces()

    return () => {
      isCancelled = true
    }
  }, [partnerKind, resolvedPlanId])

  const displayedPartners = partners ?? remotePartners

  useEffect(() => {
    if (displayedPartners.length === 0) {
      setSelectedPartnerId('')
      return
    }

    setSelectedPartnerId((current) =>
      displayedPartners.some((partner) => partner.id === current) ? current : displayedPartners[0].id
    )
  }, [displayedPartners])

  const selectedPartner = useMemo(
    () => displayedPartners.find((partner) => partner.id === selectedPartnerId) ?? displayedPartners[0] ?? null,
    [displayedPartners, selectedPartnerId]
  )
  const selectedMessages = selectedPartner
    ? [...selectedPartner.messages, ...(localMessagesByPartner[selectedPartner.id] ?? [])]
    : []
  const canPersist = Boolean(selectedPartner?.threadId && resolvedPlanId && partnerKind)

  async function handleSendMessage() {
    const trimmed = draftMessage.trim()
    if (!selectedPartner || !trimmed) return

    if (canPersist && selectedPartner.threadId) {
      await mutateRemoteWorkspace({
        action: 'send_message',
        threadId: selectedPartner.threadId,
        body: trimmed,
      })
      setDraftMessage('')
      return
    }

    const nextMessage: BookedPartnerMessage = {
      id: `local-${selectedPartner.id}-${Date.now()}`,
      sender: 'host',
      author: 'You',
      text: trimmed,
      time: 'Just now',
    }

    setLocalMessagesByPartner((current) => ({
      ...current,
      [selectedPartner.id]: [...(current[selectedPartner.id] ?? []), nextMessage],
    }))
    setDraftMessage('')
  }

  async function markDepositPlaced() {
    if (!selectedPartner?.threadId) return
    await mutateRemoteWorkspace({ action: 'mark_deposit_placed', threadId: selectedPartner.threadId })
  }

  function openVenueRentalRefund(partner: BookedPartner) {
    const transaction = partner.venueRental?.transaction
    if (!transaction) return
    setRefundPartner(partner)
    setRefundAmount(centsToDollars(transaction.amount_cents).toFixed(2))
    setRefundReason('')
    setErrorMessage(null)
  }

  async function submitVenueRentalRefund() {
    if (!refundPartner || !resolvedPlanId) return
    const transaction = refundPartner.venueRental?.transaction
    if (!transaction) return

    const refundAmountCents = dollarsToCents(refundAmount)
    if (refundAmountCents <= 0) {
      setErrorMessage('Refund amount must be greater than $0.00.')
      return
    }
    if (refundReason.trim().length < 10) {
      setErrorMessage('Refund reason must be at least 10 characters.')
      return
    }

    setIsRefundSubmitting(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`/api/planner/plans/${resolvedPlanId}/venue-payment/${transaction.id}/refund-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          refund_amount_cents: refundAmountCents,
          reason: refundReason.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Unable to request venue rental refund')

      updateVenueRentalTransaction(refundPartner.id, {
        ...transaction,
        status: 'refund_requested',
        refund_amount_cents: refundAmountCents,
        refund_reason: refundReason.trim(),
        refund_requested_at: new Date().toISOString(),
      })
      setRefundPartner(null)
      setRefundAmount('')
      setRefundReason('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to request venue rental refund')
    } finally {
      setIsRefundSubmitting(false)
    }
  }

  function updateVenueRentalTransaction(partnerId: string, transaction: NonNullable<BookedPartnerVenueRental['transaction']>) {
    setRemotePartners((current) => current.map((partner) => (
      partner.id === partnerId
        ? {
            ...partner,
            venueRental: {
              venue_booking: partner.venueRental?.venue_booking ?? null,
              transaction,
            },
          }
        : partner
    )))
  }

  async function uploadContract() {
    if (!selectedPartner?.threadId) return
    await mutateRemoteWorkspace({
      action: 'upload_document',
      threadId: selectedPartner.threadId,
      kind: 'contract',
      url: `simulated://contracts/${selectedPartner.threadId}.pdf`,
      signedAt: new Date().toISOString(),
    })
  }

  async function mutateRemoteWorkspace(body: Record<string, unknown>) {
    if (!resolvedPlanId || !partnerKind) return
    setIsMutating(true)
    setErrorMessage(null)

    try {
      const response = await fetch(`/api/planner/plans/${resolvedPlanId}/partnerships?kind=${partnerKind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as PartnershipWorkspaceResponse
      if (!response.ok) throw new Error(payload.error || 'Unable to update booked partner')
      setRemotePartners((payload.workspaces ?? []).map(mapWorkspaceToPartner))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update booked partner')
    } finally {
      setIsMutating(false)
    }
  }

  if (displayedPartners.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-card">
      <div className="border-b border-border p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Booked Partners</p>
            <h2 className="mt-2 font-display text-xl font-bold text-foreground">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            {displayedPartners.length} active
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-2">
            {displayedPartners.map((partner) => {
              const isSelected = selectedPartner?.id === partner.id

              return (
                <button
                  key={partner.id}
                  type="button"
                  onClick={() => setSelectedPartnerId(partner.id)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-smooth',
                    isSelected
                      ? 'border-primary/40 bg-sidebar-accent text-foreground'
                      : 'border-border bg-background/40 text-foreground hover:bg-muted'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{partner.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{partner.category}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                      {partner.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-card px-2 py-1.5">
                      <p className="text-muted-foreground">Payment</p>
                      <p className="mt-0.5 truncate font-semibold" title={partner.depositLabel}>
                        {partner.depositLabel}
                      </p>
                    </div>
                    <div className="rounded-md bg-card px-2 py-1.5">
                      <p className="text-muted-foreground">Next</p>
                      <p className="mt-0.5 truncate font-semibold" title={partner.nextStep}>{partner.nextStep}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          {selectedPartner ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    <h3 className="font-display text-lg font-bold text-foreground">Messages</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Thread with {selectedPartner.contactName} at {selectedPartner.name}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  Partner thread
                </span>
              </div>

              <div className="mt-5 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {selectedMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-border bg-background/50 p-3">
                <Textarea
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  placeholder={`Message ${selectedPartner.contactName}...`}
                  rows={3}
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Messages are saved to the booked partner workspace.
                  </p>
                  <Button type="button" size="sm" onClick={handleSendMessage} disabled={!draftMessage.trim() || isMutating}>
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>

              {errorMessage ? <p className="mt-3 text-sm text-destructive">{errorMessage}</p> : null}
            </>
          ) : null}
        </div>

        <div className="space-y-5 p-5">
          {selectedPartner ? (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <h3 className="font-display text-lg font-bold text-foreground">Timeline</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">Key dates and coordination milestones.</p>

                <div className="mt-4 space-y-3">
                  {selectedPartner.timeline.map((item) => (
                    <TimelineItem key={item.id} item={item} />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <h4 className="font-display text-base font-bold text-foreground">Payment Status</h4>
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground">{selectedPartner.depositLabel}</p>
                {selectedPartner.depositCents ? (
                  <p className="mt-1 text-sm text-muted-foreground">{formatCents(selectedPartner.depositCents)}</p>
                ) : null}
                <div className="mt-3 space-y-3">
                  {partnerKind === 'venue' ? (
                    <VenueRentalWorkspacePayment
                      partner={selectedPartner}
                      planId={resolvedPlanId}
                      canPersist={canPersist}
                      isMutating={isMutating}
                      onMarkDepositPlaced={markDepositPlaced}
                      onRequestRefund={openVenueRentalRefund}
                    />
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={markDepositPlaced}
                      disabled={!canPersist || isMutating || selectedPartner.nextStep !== 'Place deposit'}
                    >
                      Mark deposit placed
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={uploadContract}
                    disabled={!canPersist || isMutating || selectedPartner.nextStep !== 'Upload contract'}
                  >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Upload contract
                  </Button>
                </div>
              </div>

              <LogisticsCard partner={selectedPartner} />
              <DocumentsCard documents={selectedPartner.documents ?? []} />
            </>
          ) : null}
        </div>
      </div>

      {refundPartner ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-rental-refund-title"
            className="w-full max-w-lg rounded-3xl border border-border bg-gradient-card p-6 shadow-card"
          >
            <button
              type="button"
              aria-label="Close refund request"
              onClick={() => setRefundPartner(null)}
              disabled={isRefundSubmitting}
              className="float-right rounded-full border border-border bg-background/50 p-2 text-muted-foreground transition-smooth hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 id="venue-rental-refund-title" className="font-display text-xl font-bold text-foreground">
              Request venue rental refund
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send the request to {refundPartner.name}. Processing fees are not refunded.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-foreground">
                Refund amount
                <input
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  inputMode="decimal"
                  className="mt-2 w-full rounded-2xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                Reason
                <textarea
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-2xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                  placeholder="Explain what changed about the venue rental."
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="glass" onClick={() => setRefundPartner(null)} disabled={isRefundSubmitting}>
                Cancel
              </Button>
              <Button type="button" variant="hero" onClick={() => void submitVenueRentalRefund()} disabled={isRefundSubmitting}>
                {isRefundSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send request
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function VenueRentalWorkspacePayment({
  partner,
  planId,
  canPersist,
  isMutating,
  onMarkDepositPlaced,
  onRequestRefund,
}: {
  partner: BookedPartner
  planId: string | null
  canPersist: boolean
  isMutating: boolean
  onMarkDepositPlaced: () => void
  onRequestRefund: (partner: BookedPartner) => void
}) {
  const rental = partner.venueRental
  const booking = rental?.venue_booking ?? null
  const transaction = rental?.transaction ?? null
  const amountCents = transaction?.amount_cents ?? booking?.amount_cents ?? partner.depositCents ?? 0

  if (!booking || booking.status !== 'confirmed') {
    return (
      <div className="rounded-2xl border border-border bg-background/50 p-3">
        <p className="text-sm font-semibold text-foreground">Confirmed booking required</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Venue rental payment opens after the venue booking is confirmed. Keep this placeholder until terms are finalized.
        </p>
        <Button
          type="button"
          variant="glass"
          size="sm"
          className="mt-3"
          onClick={onMarkDepositPlaced}
          disabled={!canPersist || isMutating || partner.nextStep !== 'Place deposit'}
        >
          Mark deposit placed
        </Button>
      </div>
    )
  }

  if (!transaction || ['pending_builder_payment', 'checkout_created', 'failed', 'cancelled'].includes(transaction.status)) {
    return (
      <div className="rounded-2xl border border-primary/25 bg-primary/10 p-3">
        <p className="text-sm font-semibold text-foreground">Venue rental ready</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Choose card or ACH before Stripe Checkout opens. The venue receives the full negotiated rental amount.
        </p>
        <div className="mt-3">
          {planId ? (
            <VenueRentalPaymentButton
              planId={planId}
              venueBookingId={booking.id}
              venueName={partner.name}
              amountCents={amountCents}
              venuePaymentTransactionId={transaction?.id ?? null}
            />
          ) : (
            <Button type="button" variant="hero" disabled>
              Pay {formatCents(amountCents)} rental
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (transaction.status === 'paid') {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/10 p-3">
        <p className="text-sm font-semibold text-success">
          Paid {formatCents(transaction.amount_cents)}{transaction.paid_at ? ` on ${formatRelativeTime(transaction.paid_at)}` : ''}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Transfer ID: {transaction.stripe_transfer_id ?? 'pending from Stripe'}
        </p>
        <button
          type="button"
          onClick={() => onRequestRefund(partner)}
          className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-secondary underline-offset-4 hover:underline"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Request refund
        </button>
      </div>
    )
  }

  if (transaction.status === 'refund_requested') {
    return (
      <div className="rounded-2xl border border-secondary/30 bg-secondary/10 p-3">
        <p className="text-sm font-semibold text-foreground">
          Refund of {formatCents(transaction.refund_amount_cents ?? 0)} requested
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Awaiting venue response.</p>
        <span className="mt-3 inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1 text-xs text-muted-foreground" title="Cancel not yet supported - contact the 3rdPlace team">
          <AlertTriangle className="h-3.5 w-3.5" />
          Cancel not yet supported
        </span>
      </div>
    )
  }

  if (transaction.status === 'refund_approved' || transaction.status === 'refunded_partial' || transaction.status === 'refunded_full') {
    return (
      <div className="rounded-2xl border border-secondary/30 bg-secondary/10 p-3">
        <p className="text-sm font-semibold text-secondary">
          Refunded {formatCents(transaction.refund_amount_cents ?? 0)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {transaction.refund_approved_at ? `Approved ${formatRelativeTime(transaction.refund_approved_at)}.` : 'Refund is being finalized.'}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-background/50 p-3 text-sm text-muted-foreground">
      Venue rental status: {formatLabel(transaction.status)}
    </div>
  )
}

/**
 * Renders one partner message with sender-aware alignment.
 */
function MessageBubble({ message }: { message: BookedPartnerMessage }) {
  const isOrganizer = message.sender === 'organizer' || message.sender === 'host'

  return (
    <div className={cn('flex', isOrganizer ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isOrganizer
            ? 'bg-primary text-primary-foreground'
            : message.sender === 'agent'
              ? 'border border-border bg-background text-foreground'
              : 'bg-muted text-foreground'
        )}
      >
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold opacity-80">
          <UserRound className="h-3.5 w-3.5" />
          <span>{message.author}</span>
          <span>·</span>
          <span>{message.time}</span>
        </div>
        <p className="break-words">{message.text}</p>
      </div>
    </div>
  )
}

/**
 * Renders one timeline milestone for a booked partner.
 */
function TimelineItem({ item }: { item: BookedPartnerTimelineItem }) {
  const statusStyles = {
    done: 'bg-success/10 text-success border-success/30',
    due: 'bg-warning/10 text-warning border-warning/30',
    upcoming: 'bg-muted text-muted-foreground border-border',
  } satisfies Record<BookedPartnerTimelineItem['status'], string>

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border', statusStyles[item.status])}>
          {item.status === 'done' ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-foreground">{item.label}</p>
            <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {item.date}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
        </div>
      </div>
    </div>
  )
}

function LogisticsCard({ partner }: { partner: BookedPartner }) {
  const logistics = partner.logistics ?? {}
  const rows = [
    { label: 'Load-in', value: logistics.loadInTime ?? 'Not set' },
    { label: 'Contact', value: logistics.contactName ?? partner.contactName },
    { label: 'Address', value: logistics.address ?? 'Not set' },
    { label: 'Parking', value: logistics.parkingNotes ?? 'Not set' },
  ]

  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2">
        <MapPinned className="h-4 w-4 text-primary" />
        <h4 className="font-display text-base font-bold text-foreground">Day-of Logistics</h4>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">{row.label}</span>
            <span className="min-w-0 text-right font-medium text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DocumentsCard({ documents }: { documents: BookedPartnerDocument[] }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        <h4 className="font-display text-base font-bold text-foreground">Documents</h4>
      </div>
      <div className="mt-3 space-y-2">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          documents.map((document) => (
            <a
              key={document.id}
              href={document.url.startsWith('simulated://') ? undefined : document.url}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <span className="font-semibold text-foreground">{document.label}</span>
              <span className="text-xs text-muted-foreground">{document.signedAt ? 'Signed' : 'Stored'}</span>
            </a>
          ))
        )}
      </div>
    </div>
  )
}

function mapWorkspaceToPartner(workspace: PartnershipWorkspacePayload): BookedPartner {
  return {
    id: workspace.thread.id,
    threadId: workspace.thread.id,
    name: workspace.partner.name,
    category: workspace.partner.category,
    status: formatLabel(workspace.thread.status),
    depositLabel: workspace.payment_status.label,
    depositCents: workspace.payment_status.deposit_cents,
    nextStep: workspace.next_required_action,
    contactName: workspace.logistics.contact_name ?? 'partner',
    messages: workspace.messages.map((message) => ({
      id: message.id,
      sender: message.sender_kind,
      author: getAuthorLabel(message.sender_kind),
      text: message.body,
      time: formatRelativeTime(message.created_at),
    })),
    timeline: workspace.milestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.label,
      date: milestone.completed_at ? 'Done' : milestone.due_date ?? 'TBD',
      status: milestone.completed_at ? 'done' : isNextMilestone(milestone.label, workspace.next_required_action) ? 'due' : 'upcoming',
      detail: getMilestoneDetail(milestone.label, Boolean(milestone.completed_at)),
    })),
    documents: workspace.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      label: formatLabel(document.kind),
      url: document.url,
      signedAt: document.signed_at,
    })),
    venueRental: workspace.venue_rental ?? null,
    logistics: {
      loadInTime: workspace.logistics.load_in_time,
      contactName: workspace.logistics.contact_name,
      address: workspace.logistics.address,
      parkingNotes: workspace.logistics.parking_notes,
    },
  }
}

function readLivePlanId() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem('planner-live-plan')
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<{ planId: string }>
    return typeof parsed.planId === 'string' ? parsed.planId : null
  } catch {
    return null
  }
}

function getAuthorLabel(sender: BookedPartnerMessage['sender']) {
  if (sender === 'host' || sender === 'organizer') return 'You'
  if (sender === 'agent') return '3rdPlace Agent'
  if (sender === 'concierge') return '3rdPlace team'
  return 'Partner'
}

function isNextMilestone(label: string, nextAction: string) {
  return (
    (label === 'Deposit placed' && nextAction === 'Place deposit') ||
    (label === 'Contract uploaded' && nextAction === 'Upload contract') ||
    (label === 'Day-of logistics confirmed' && nextAction === 'Confirm day-of logistics')
  )
}

function getMilestoneDetail(label: string, completed: boolean) {
  if (completed) return `${label} is complete.`
  if (label === 'Deposit placed') return 'Record the deposit once payment is authorized or collected.'
  if (label === 'Contract uploaded') return 'Attach the signed agreement before final logistics.'
  if (label === 'Day-of logistics confirmed') return 'Confirm load-in, contact, address, parking, and timing.'
  return 'Waiting on partner workspace progress.'
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function formatRelativeTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
