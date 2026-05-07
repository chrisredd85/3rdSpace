'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CalendarPlus, CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { OpportunityResponseContext, OpportunityResponseAction } from '@/lib/opportunities/tokenValidate'
import { cn } from '@/lib/utils'

interface OpportunityResponseFormProps {
  token: string
  opportunity: OpportunityResponseContext
}

type SubmitState = 'idle' | 'submitting' | 'stripe_gate' | 'submitted' | 'error'

/**
 * Public magic-link response form for venue and vendor opportunity invites.
 */
export function OpportunityResponseForm({ token, opportunity }: OpportunityResponseFormProps) {
  const [action, setAction] = useState<OpportunityResponseAction>('accept')
  const [notes, setNotes] = useState('')
  const [quotedDollars, setQuotedDollars] = useState('')
  const [contactName, setContactName] = useState('')
  const [loadInTime, setLoadInTime] = useState('')
  const [address, setAddress] = useState('')
  const [parkingNotes, setParkingNotes] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [error, setError] = useState('')
  const [submittedQuoteCents, setSubmittedQuoteCents] = useState<number | null>(null)

  const isVendor = opportunity.kind === 'vendor'
  const status = readString(opportunity.invite.status) ?? 'queued'
  const partnerName = getPartnerName(opportunity)
  const alreadyResponded = ['accepted', 'declined', 'countered', 'expired'].includes(status)
  const quoteRequested = isVendor && opportunity.brief.quote_requested === true
  const summary = readString(opportunity.brief.summary) ?? readString(opportunity.brief.title)
  const submittedAction = submitState === 'submitted' ? action : getActionFromInviteStatus(status)

  const actionCopy = useMemo(() => {
    if (action === 'accept') return isVendor ? 'Accept request' : 'Accept hosting opportunity'
    if (action === 'decline') return 'Decline'
    return isVendor ? 'Counter with scope' : 'Counter terms'
  }, [action, isVendor])

  async function submitResponse() {
    setSubmitState('submitting')
    setError('')

    const quotedAmountCents = quotedDollars.trim()
      ? Math.round(Number(quotedDollars.replace(/[$,]/g, '')) * 100)
      : null
    const safeQuotedAmountCents = Number.isFinite(quotedAmountCents) ? quotedAmountCents : null

    const response = await fetch(`/api/opportunities/respond/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        notes,
        quotedAmountCents: safeQuotedAmountCents,
        contactName,
        loadInTime,
        address,
        parkingNotes,
      }),
    })

    if (!response.ok) {
      setSubmitState('error')
      setError('Unable to save your response. Try again or contact 3rdPlace.')
      return
    }

    setSubmittedQuoteCents(safeQuotedAmountCents)
    if (action === 'accept' && requiresStripeGate(opportunity, safeQuotedAmountCents)) {
      setSubmitState('stripe_gate')
      return
    }

    setSubmitState('submitted')
  }

  if (opportunity.isExpired || status === 'expired') {
    return (
      <ResponseShell partnerName={partnerName} eyebrow="Response link expired">
        <StatusBlock
          icon="expired"
          title="This opportunity link has expired."
          body="The host deadline has passed. Contact 3rdPlace if you still want to respond."
        />
      </ResponseShell>
    )
  }

  if (submitState === 'submitted' || alreadyResponded) {
    return (
      <ResponseShell partnerName={partnerName} eyebrow={`${formatKind(opportunity.kind)} response`}>
        <SubmittedResponseScreen
          action={submittedAction}
          token={token}
          opportunity={opportunity}
          partnerEmail={getPartnerEmail(opportunity)}
        />
      </ResponseShell>
    )
  }

  if (submitState === 'stripe_gate') {
    return (
      <ResponseShell partnerName={partnerName} eyebrow="Payout setup required">
        <StripePayoutGate
          token={token}
          opportunity={opportunity}
          amountCents={getPaidOpportunityAmountCents(opportunity, submittedQuoteCents)}
          onSkip={() => setSubmitState('submitted')}
        />
      </ResponseShell>
    )
  }

  return (
    <ResponseShell partnerName={partnerName} eyebrow={`${formatKind(opportunity.kind)} opportunity`}>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-foreground">{getBriefTitle(opportunity)}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {summary ?? 'Review the opportunity and send your response to the organizer.'}
            </p>
          </div>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Response requested
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <InfoTile label="Guests" value={readString(opportunity.brief.guest_count) ?? 'TBD'} />
          <InfoTile label="Date" value={formatDate(opportunity)} />
          <InfoTile label="Budget" value={formatBudget(opportunity)} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          {(['accept', 'counter', 'decline'] as OpportunityResponseAction[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAction(value)}
              className={cn(
                'rounded-xl border px-4 py-3 text-left text-sm transition',
                action === value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              <span className="block font-semibold text-foreground">
                {value === 'accept' ? 'Accept' : value === 'counter' ? 'Counter' : 'Decline'}
              </span>
              <span className="mt-1 block">
                {value === 'accept'
                  ? 'Terms work as proposed.'
                  : value === 'counter'
                    ? 'Suggest a scope or price change.'
                    : 'Not a fit this time.'}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contactName">Best day-of contact</Label>
            <Input id="contactName" value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loadInTime">Load-in or arrival window</Label>
            <Input id="loadInTime" value={loadInTime} onChange={(event) => setLoadInTime(event.target.value)} placeholder="e.g. 4:00 PM" />
          </div>
          {quoteRequested || action === 'counter' ? (
            <div className="space-y-2">
              <Label htmlFor="quotedDollars">Quote amount ($)</Label>
              <Input id="quotedDollars" inputMode="decimal" value={quotedDollars} onChange={(event) => setQuotedDollars(event.target.value)} />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="address">Address or meet point</Label>
            <Input id="address" value={address} onChange={(event) => setAddress(event.target.value)} />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="notes">Notes for the organizer</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Share availability, constraints, package details, or counter terms."
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="parkingNotes">Parking or access notes</Label>
          <Textarea
            id="parkingNotes"
            value={parkingNotes}
            onChange={(event) => setParkingNotes(event.target.value)}
            placeholder="Loading entrance, parking, security desk, or access instructions."
          />
        </div>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Your response updates the organizer workspace immediately. No payment is charged here.
          </p>
          <Button type="button" onClick={submitResponse} disabled={submitState === 'submitting'}>
            {submitState === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {actionCopy}
          </Button>
        </div>
      </div>
    </ResponseShell>
  )
}

function SubmittedResponseScreen({
  action,
  token,
  opportunity,
  partnerEmail,
}: {
  action: OpportunityResponseAction
  token: string
  opportunity: OpportunityResponseContext
  partnerEmail: string | null
}) {
  const actionUi = getSubmittedActionUi(action)
  const Icon = actionUi.icon
  const calendarEvent = buildCalendarEvent(opportunity)
  const signupHref = `/signup/${opportunity.kind}?from_opportunity=${encodeURIComponent(token)}`
  const briefTitle = getBriefTitle(opportunity)
  const steps = [
    <>
      Organizer reviews your response for{' '}
      <a href="#opportunity-brief" className="font-semibold text-foreground underline-offset-4 hover:underline">
        {briefTitle}
      </a>
    </>,
    partnerEmail
      ? `You'll receive an email confirmation at ${partnerEmail}`
      : "You'll receive an email confirmation once contact details are confirmed",
    'Once confirmed, deposit/contract details will arrive',
    action === 'counter' ? "We'll loop you in once the organizer accepts or counters back." : null,
  ].filter(Boolean) as ReactNode[]

  function handleCalendarDownload() {
    if (!calendarEvent) return
    downloadIcsFile(calendarEvent)
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full', actionUi.iconClass)}>
          <Icon className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('font-display text-xs font-bold uppercase tracking-[0.18em]', actionUi.eyebrowClass)}>
            {actionUi.eyebrow}
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold text-foreground sm:text-3xl">
            {actionUi.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            3rdPlace will update the organizer and keep the next steps moving from their planner workspace.
          </p>
        </div>
      </div>

      <div id="opportunity-brief" className="mt-8 rounded-2xl border border-border bg-background p-5">
        <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Opportunity brief</p>
        <h3 className="mt-2 font-display text-lg font-bold text-foreground">{briefTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {readString(opportunity.brief.summary) ?? 'The organizer will review your response against the opportunity requirements.'}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-background p-5">
        <h3 className="font-display text-lg font-bold text-foreground">What happens next</h3>
        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3 text-sm leading-6 text-muted-foreground">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          onClick={handleCalendarDownload}
          disabled={!calendarEvent}
          title={calendarEvent ? 'Download calendar file' : 'Calendar date is not available yet'}
        >
          <CalendarPlus className="h-4 w-4" />
          Add to calendar
        </Button>
        <Button type="button" asChild>
          <a href={signupHref}>Manage your opportunities</a>
        </Button>
      </div>

      <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
        Questions? Reply to the email or contact 3rdPlace.
      </p>
    </div>
  )
}

function StripePayoutGate({
  token,
  opportunity,
  amountCents,
  onSkip,
}: {
  token: string
  opportunity: OpportunityResponseContext
  amountCents: number | null
  onSkip: () => void
}) {
  const dashboardPrefix = opportunity.kind === 'venue' ? 'venue' : 'vendor'
  const setupHref = `/${dashboardPrefix}/payouts?connect=stripe&from_opportunity=${encodeURIComponent(token)}`
  const signupHref = `/signup/${opportunity.kind}?from_opportunity=${encodeURIComponent(token)}&next=payouts`
  const amountLabel = amountCents && amountCents > 0 ? formatCurrency(amountCents) : 'this paid opportunity'

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 shadow-sm sm:p-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <DollarIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-primary">Payout setup needed</p>
          <h2 className="mt-2 font-display text-2xl font-bold text-foreground sm:text-3xl">
            Set up payouts to receive your deposit
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Your acceptance is recorded. Because {amountLabel} may require a deposit or quote payment, connect Stripe before funds can move.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <p className="font-semibold text-foreground">1. Create or sign in</p>
          <p className="mt-1">Use the opportunity link so we can attach this response to your account.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">2. Open payouts</p>
          <p className="mt-1">Your dashboard will send you through the existing Stripe Connect flow.</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">3. Return here</p>
          <p className="mt-1">After setup, your response stays recorded and the organizer can continue.</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" asChild>
          <a href={setupHref}>Set up payouts</a>
        </Button>
        <Button type="button" variant="ghost" asChild>
          <a href={signupHref}>Create account</a>
        </Button>
        <Button type="button" variant="outline" onClick={onSkip}>
          View recorded response
        </Button>
      </div>
    </div>
  )
}

function DollarIcon() {
  return <span className="font-display text-2xl font-bold">$</span>
}

function getSubmittedActionUi(action: OpportunityResponseAction) {
  if (action === 'decline') {
    return {
      icon: XCircle,
      title: 'Declined',
      eyebrow: 'Response recorded',
      iconClass: 'bg-destructive/10 text-destructive',
      eyebrowClass: 'text-destructive',
    }
  }

  if (action === 'counter') {
    return {
      icon: RotateCcw,
      title: 'Countered',
      eyebrow: 'Counter sent',
      iconClass: 'bg-secondary/10 text-secondary',
      eyebrowClass: 'text-secondary',
    }
  }

  return {
    icon: CheckCircle2,
    title: 'Accepted',
    eyebrow: 'Opportunity accepted',
    iconClass: 'bg-primary/10 text-primary',
    eyebrowClass: 'text-primary',
  }
}

function getActionFromInviteStatus(status: string): OpportunityResponseAction {
  if (status === 'declined') return 'decline'
  if (status === 'countered') return 'counter'
  return 'accept'
}

function getPartnerEmail(opportunity: OpportunityResponseContext) {
  return (
    readString(opportunity.partner?.contact_email) ??
    readString(opportunity.partner?.email) ??
    readString(opportunity.invite.response_email)
  )
}

function requiresStripeGate(opportunity: OpportunityResponseContext, submittedQuoteCents: number | null) {
  if (hasPartnerStripeAccount(opportunity)) return false
  return Boolean(getPaidOpportunityAmountCents(opportunity, submittedQuoteCents))
}

function hasPartnerStripeAccount(opportunity: OpportunityResponseContext) {
  return Boolean(readString(opportunity.partner?.stripe_account_id))
}

function getPaidOpportunityAmountCents(opportunity: OpportunityResponseContext, submittedQuoteCents: number | null) {
  return firstPositiveNumber([
    submittedQuoteCents,
    readMoneyCents(opportunity.invite.proposed_deposit_cents),
    readMoneyCents(opportunity.invite.quoted_price_cents),
    readMoneyCents(opportunity.invite.quoted_amount_cents),
    readMoneyCents(opportunity.invite.requested_amount_cents),
    readMoneyCents(opportunity.invite.deposit_amount_cents),
  ])
}

function firstPositiveNumber(values: Array<number | null>) {
  return values.find((value): value is number => typeof value === 'number' && value > 0) ?? null
}

interface CalendarEventData {
  title: string
  description: string
  startDate: Date
  endDate: Date
  isAllDay: boolean
}

function buildCalendarEvent(opportunity: OpportunityResponseContext): CalendarEventData | null {
  const dateNeeded = readString(opportunity.brief.date_needed)
  const windowStart = readString(opportunity.brief.date_window_start)
  const windowEnd = readString(opportunity.brief.date_window_end)
  const dateWindow = readString(opportunity.brief.date_window)
  const parsedRange = parseDateWindow(dateNeeded, windowStart, windowEnd, dateWindow)

  if (!parsedRange) return null

  return {
    title: getBriefTitle(opportunity),
    description: readString(opportunity.brief.summary) ?? '3rdPlace opportunity response',
    startDate: parsedRange.startDate,
    endDate: parsedRange.endDate,
    isAllDay: parsedRange.isAllDay,
  }
}

function parseDateWindow(
  dateNeeded: string | null,
  windowStart: string | null,
  windowEnd: string | null,
  dateWindow: string | null
) {
  const rangeMatch = dateWindow?.match(/\[?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*,\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\)?\]?/)
  const start = parseCalendarDate(dateNeeded ?? windowStart ?? rangeMatch?.[1] ?? null)
  if (!start) return null

  const explicitEnd = parseCalendarDate(windowEnd ?? rangeMatch?.[2] ?? null)
  const end = explicitEnd && explicitEnd > start ? explicitEnd : addDays(start, 1)

  return {
    startDate: start,
    endDate: explicitEnd ? addDays(end, 1) : end,
    isAllDay: isDateOnly(dateNeeded ?? windowStart ?? rangeMatch?.[1] ?? ''),
  }
}

function parseCalendarDate(value: string | null) {
  if (!value) return null

  const isoDate = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})/)
  if (isoDate) {
    return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isDateOnly(value: string) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function downloadIcsFile(event: CalendarEventData) {
  const now = new Date()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//3rdPlace//Opportunity Response//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${createIcsSafeText(`${event.title}-${event.startDate.toISOString()}`)}@3rdplace`,
    `DTSTAMP:${formatIcsDateTime(now)}`,
    event.isAllDay
      ? `DTSTART;VALUE=DATE:${formatIcsDate(event.startDate)}`
      : `DTSTART:${formatIcsDateTime(event.startDate)}`,
    event.isAllDay
      ? `DTEND;VALUE=DATE:${formatIcsDate(event.endDate)}`
      : `DTEND:${formatIcsDateTime(event.endDate)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${createIcsSafeText(event.title) || '3rdplace-opportunity'}.ics`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function formatIcsDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
}

function formatIcsDateTime(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('') + `T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function createIcsSafeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function ResponseShell({
  partnerName,
  eyebrow,
  children,
}: {
  partnerName: string
  eyebrow: string
  children: ReactNode
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-foreground">{partnerName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Secure 3rdPlace response link</p>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </main>
  )
}

function StatusBlock({
  icon,
  title,
  body,
}: {
  icon: 'accepted' | 'declined' | 'expired'
  title: string
  body: string
}) {
  const Icon = icon === 'expired' ? Clock : icon === 'declined' ? XCircle : CheckCircle2
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 font-display text-2xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium text-foreground" title={value}>{value}</p>
    </div>
  )
}

function getPartnerName(opportunity: OpportunityResponseContext) {
  if (opportunity.kind === 'venue') {
    return readString(opportunity.partner?.venue_name) ?? readString(opportunity.partner?.name) ?? 'Venue opportunity'
  }
  return readString(opportunity.partner?.name) ?? 'Vendor opportunity'
}

function getBriefTitle(opportunity: OpportunityResponseContext) {
  if (opportunity.kind === 'vendor') {
    return `${formatLabel(readString(opportunity.brief.package_type) ?? 'Vendor')} request`
  }
  return readString(opportunity.brief.title) ?? `${formatLabel(readString(opportunity.brief.event_type) ?? 'Event')} hosting opportunity`
}

function formatKind(kind: string) {
  return kind === 'venue' ? 'Venue' : 'Vendor'
}

function formatDate(opportunity: OpportunityResponseContext) {
  const dateNeeded = readString(opportunity.brief.date_needed)
  if (dateNeeded) return dateNeeded
  const start = readString(opportunity.brief.date_window_start)
  const end = readString(opportunity.brief.date_window_end)
  if (start && end && start !== end) return `${start} to ${end}`
  return start ?? end ?? 'Flexible'
}

function formatBudget(opportunity: OpportunityResponseContext) {
  const budget = readNumber(opportunity.brief.budget_cents)
  if (budget) return formatCurrency(budget)
  const range = readString(opportunity.brief.budget_range_cents)
  const matches = range?.match(/\d+/g)
  if (!matches?.length) return 'TBD'
  return formatCurrency(Number(matches.at(-1)))
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (word) => (word.toUpperCase() === 'AV' ? 'AV' : word.charAt(0).toUpperCase() + word.slice(1)))
}

function readString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readMoneyCents(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null

  const normalized = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(normalized) ? Math.round(normalized) : null
}
