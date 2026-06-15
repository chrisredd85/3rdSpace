'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Handshake,
  MessageSquare,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  bookingItems,
  drilldownSections,
  formatCents,
  founderDinner,
  guestSummary,
  mockupEvents,
  moneyLines,
  moneySummary,
  photoDetail,
  venueDetail,
  type BannerState,
  type BookingItem,
  type BookingKey,
  type DrilldownSection,
  type MockupEventCard,
  type SectionKey,
  type StatusTone,
} from './mockup-data'

interface ExperiencesBookingMockupProps {
  initialBannerState: BannerState
}

const sectionIcons: Record<SectionKey, typeof ClipboardList> = {
  plan: ClipboardList,
  bookings: Handshake,
  money: CircleDollarSign,
  guests: Users,
}

export function ExperiencesBookingMockup({ initialBannerState }: ExperiencesBookingMockupProps) {
  const [selectedEventId, setSelectedEventId] = useState('founder-dinner')
  const [openSection, setOpenSection] = useState<SectionKey>('bookings')
  const [openBooking, setOpenBooking] = useState<BookingKey>('venue')
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const selectedEvent = mockupEvents.find((event) => event.id === selectedEventId) ?? mockupEvents[0]
  const isFounderDinner = selectedEvent.id === 'founder-dinner'
  const bannerState = initialBannerState
  const eventAttentionLabel = bannerState === 'calm' && isFounderDinner ? 'calm' : selectedEvent.attentionLabel

  return (
    <div className="min-h-full bg-cream text-ink">
      <div className="border-b border-tan bg-cream/90 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink-faint">
            Founder Dinner / June 28 / <span className="text-clay">Booking</span>
          </p>
          <div className="hidden items-center gap-2 sm:flex">
            <StateLink state="urgent" isActive={bannerState === 'urgent'} label="Urgent" />
            <StateLink state="calm" isActive={bannerState === 'calm'} label="Calm" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
        <EventSelector
          selectedEventId={selectedEventId}
          selectedAttentionLabel={eventAttentionLabel}
          onSelectEvent={(eventId) => {
            setSelectedEventId(eventId)
            setOpenSection('bookings')
            setOpenBooking('venue')
          }}
        />

        {isFounderDinner ? (
          <>
            <EventHeader />
            <NeedsYouBanner
              bannerState={bannerState}
              onReviewApproval={() => {
                setOpenSection(bannerState === 'calm' ? 'money' : 'bookings')
                setOpenBooking('venue')
              }}
            />
            <DrilldownRecord
              openSection={openSection}
              openBooking={openBooking}
              onToggleSection={(sectionKey) => setOpenSection((current) => (current === sectionKey ? 'bookings' : sectionKey))}
              onToggleBooking={(bookingKey) => setOpenBooking((current) => (current === bookingKey ? 'venue' : bookingKey))}
              onOpenApprovalModal={() => setShowApprovalModal(true)}
            />
          </>
        ) : (
          <PlaceholderEventState event={selectedEvent} onReturn={() => setSelectedEventId('founder-dinner')} />
        )}
      </div>

      {showApprovalModal ? <ApprovalModal onClose={() => setShowApprovalModal(false)} /> : null}
    </div>
  )
}

function StateLink({ state, isActive, label }: { state: BannerState; isActive: boolean; label: string }) {
  const href = state === 'calm' ? '/planner/experiences/mockup?state=calm' : '/planner/experiences/mockup'

  return (
    <a
      href={href}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-semibold transition-smooth',
        isActive ? 'border-clay bg-clay-tint text-clay-deep' : 'border-tan text-ink-soft hover:border-clay/50 hover:text-ink'
      )}
    >
      {label}
    </a>
  )
}

function EventSelector({
  selectedEventId,
  selectedAttentionLabel,
  onSelectEvent,
}: {
  selectedEventId: string
  selectedAttentionLabel: string
  onSelectEvent: (eventId: string) => void
}) {
  return (
    <section aria-label="Event selector" className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="flex min-w-max snap-x gap-3 lg:min-w-0 lg:grid lg:grid-cols-4">
        {mockupEvents.map((event) => {
          const isSelected = event.id === selectedEventId
          const attentionLabel = isSelected ? selectedAttentionLabel : event.attentionLabel

          return (
            <button
              key={event.id}
              type="button"
              onClick={() => onSelectEvent(event.id)}
              className={cn(
                'group w-[17rem] snap-start rounded-lg border bg-cream-deep/45 p-4 text-left transition-smooth lg:w-auto',
                isSelected
                  ? 'border-clay bg-cream shadow-card'
                  : 'border-tan hover:border-clay/45 hover:bg-cream'
              )}
              aria-pressed={isSelected}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">
                  {event.dateLabel} · {event.metro}
                </p>
                <span className={cn('mt-1 h-2.5 w-2.5 rounded-full', dotClass(event.tone))} />
              </div>
              <h2 className="mt-4 truncate font-display text-xl font-bold leading-tight text-ink">{event.title}</h2>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-ink-faint">{event.timingLabel}</p>
                <p className={cn('text-xs font-bold uppercase tracking-[0.1em]', attentionClass(event.tone))}>
                  {attentionLabel}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function EventHeader() {
  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div>
        <h1 className="font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">{founderDinner.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">
          {founderDinner.dateLabel} · {founderDinner.description}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {founderDinner.chips.map((chip) => (
          <span key={chip} className="rounded-full border border-tan bg-cream px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">
            {chip}
          </span>
        ))}
      </div>
    </section>
  )
}

function NeedsYouBanner({
  bannerState,
  onReviewApproval,
}: {
  bannerState: BannerState
  onReviewApproval: () => void
}) {
  const banner = bannerState === 'calm' ? founderDinner.calmBanner : founderDinner.urgentBanner

  return (
    <section
      className={cn(
        'rounded-lg border p-5 sm:p-6',
        bannerState === 'calm' ? 'border-forest/20 bg-forest-tint/45' : 'border-clay/25 bg-clay-tint/45'
      )}
      aria-label="What needs you"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <p className={cn('text-xs font-bold uppercase tracking-[0.18em]', bannerState === 'calm' ? 'text-forest' : 'text-clay-deep')}>
            What needs you
          </p>
          <h2 className="mt-3 max-w-4xl font-display text-xl font-bold leading-tight text-ink sm:text-2xl">{banner.eyebrow}</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-ink sm:text-base">{banner.title}</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft sm:text-base">{banner.body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-stretch">
          <Button type="button" onClick={onReviewApproval} className="bg-clay text-cream hover:bg-clay-deep">
            {banner.primaryCta}
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" onClick={onReviewApproval} className="border-clay/35 bg-cream/70 text-clay-deep hover:bg-cream">
            {banner.secondaryCta}
          </Button>
          <p className="max-w-[17rem] text-xs leading-5 text-ink-faint">{founderDinner.historyLabel}</p>
        </div>
      </div>
    </section>
  )
}

function DrilldownRecord({
  openSection,
  openBooking,
  onToggleSection,
  onToggleBooking,
  onOpenApprovalModal,
}: {
  openSection: SectionKey
  openBooking: BookingKey
  onToggleSection: (sectionKey: SectionKey) => void
  onToggleBooking: (bookingKey: BookingKey) => void
  onOpenApprovalModal: () => void
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-tan bg-cream shadow-card" aria-label="Event operating record">
      {drilldownSections.map((section) => (
        <div key={section.key} className="border-b border-tan last:border-b-0">
          <SectionRow section={section} isOpen={openSection === section.key} onClick={() => onToggleSection(section.key)} />
          {openSection === section.key ? (
            <div className="border-t border-tan bg-cream-deep/25 px-3 py-3 sm:px-6 sm:py-5">
              {section.key === 'plan' ? <PlanExpanded /> : null}
              {section.key === 'bookings' ? (
                <BookingsExpanded openBooking={openBooking} onToggleBooking={onToggleBooking} onOpenApprovalModal={onOpenApprovalModal} />
              ) : null}
              {section.key === 'money' ? <MoneyExpanded /> : null}
              {section.key === 'guests' ? <GuestsExpanded /> : null}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function SectionRow({ section, isOpen, onClick }: { section: DrilldownSection; isOpen: boolean; onClick: () => void }) {
  const Icon = sectionIcons[section.key]

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full gap-4 px-4 py-6 text-left transition-smooth hover:bg-cream-deep/40 sm:grid-cols-[3rem_1fr_auto_auto] sm:items-center sm:px-8 sm:py-8"
      aria-expanded={isOpen}
    >
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">{section.number}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-ink-faint sm:hidden" />
          <span className="font-display text-xl font-bold leading-tight text-ink sm:text-2xl">{section.title}</span>
        </span>
        <span className="mt-1 block text-sm leading-6 text-ink-soft sm:text-base">{section.summary}</span>
      </span>
      <StatusPill tone={section.tone}>{section.status}</StatusPill>
      {isOpen ? <ChevronDown className="h-5 w-5 text-ink-faint" /> : <ChevronRight className="h-5 w-5 text-ink-faint" />}
    </button>
  )
}

function BookingsExpanded({
  openBooking,
  onToggleBooking,
  onOpenApprovalModal,
}: {
  openBooking: BookingKey
  onToggleBooking: (bookingKey: BookingKey) => void
  onOpenApprovalModal: () => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-tan bg-cream">
      {bookingItems.map((item) => (
        <div key={item.key} className="border-b border-tan last:border-b-0">
          <BookingItemRow item={item} isOpen={openBooking === item.key} onClick={() => onToggleBooking(item.key)} />
          {openBooking === item.key ? (
            <div className="border-t border-tan bg-cream-deep/35 px-4 py-4 sm:px-8 sm:py-6">
              {item.key === 'venue' ? <VenueDetail onOpenApprovalModal={onOpenApprovalModal} /> : null}
              {item.key === 'photo' ? <PhotoDetail /> : null}
              {item.key === 'food' ? <FoodDetail /> : null}
              {item.key === 'checkin' ? <CheckinDetail /> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function BookingItemRow({ item, isOpen, onClick }: { item: BookingItem; isOpen: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full gap-3 px-4 py-5 text-left transition-smooth hover:bg-cream-deep/45 sm:grid-cols-[1rem_minmax(0,1.3fr)_auto_auto_auto] sm:items-center sm:px-8"
      aria-expanded={isOpen}
    >
      <span className={cn('mt-2 h-2.5 w-2.5 rounded-full sm:mt-0', dotClass(item.tone))} />
      <span className="min-w-0">
        <span className="block text-base font-semibold leading-6 text-ink">
          {item.title} <span className="ml-2 font-normal text-ink-soft">{item.partner}</span>
        </span>
        <span className="mt-1 block text-sm text-ink-faint">{item.detail}</span>
      </span>
      <span className="font-mono text-sm font-semibold text-ink sm:text-base">
        {item.costCents === null ? '—' : formatCents(item.costCents)} {item.costLabel ? <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">{item.costLabel}</span> : null}
      </span>
      <StatusPill tone={item.tone}>{item.status}</StatusPill>
      {isOpen ? <ChevronDown className="h-5 w-5 text-ink-faint" /> : <ChevronRight className="h-5 w-5 text-ink-faint" />}
    </button>
  )
}

function VenueDetail({ onOpenApprovalModal }: { onOpenApprovalModal: () => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <p className="font-display text-xl font-bold text-ink">{venueDetail.title}</p>
        <p className="mt-1 text-sm text-ink-soft">{venueDetail.address}</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <DetailMetric label="Offer" value={venueDetail.offer} />
          <DetailMetric label="Hold deadline" value={venueDetail.holdDeadline} />
          <DetailMetric label="Deposit" value={venueDetail.deposit} />
        </div>
        <div className="mt-5 rounded-lg border border-tan bg-cream/80 p-4">
          <p className="text-sm font-semibold text-ink">Included terms</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-soft">
            {venueDetail.includedTerms.map((term) => (
              <li key={term} className="flex gap-2">
                <Check className="mt-1 h-4 w-4 shrink-0 text-forest" />
                <span>{term}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rounded-lg border border-clay/25 bg-clay-tint/45 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-clay-deep">Approval required</p>
        <p className="mt-3 text-sm leading-6 text-ink-soft">
          Approval creates the hold record and commits the refundable deposit. No payment or outbound message is sent from this mockup.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button type="button" onClick={onOpenApprovalModal} className="bg-clay text-cream hover:bg-clay-deep">
            Approve hold
          </Button>
          <Button type="button" variant="outline" className="border-tan bg-cream">
            Ask for change
          </Button>
          <Button type="button" variant="ghost" className="justify-start px-0 text-clay-deep hover:bg-transparent hover:text-clay">
            View full terms
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <button type="button" className="mt-4 text-left text-xs font-semibold leading-5 text-ink-soft underline decoration-tan underline-offset-4 hover:text-ink">
          Use last event terms ({venueDetail.reuseSource})
        </button>
      </div>
    </div>
  )
}

function PhotoDetail() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div>
        <p className="font-display text-xl font-bold text-ink">{photoDetail.title}</p>
        <p className="mt-2 text-base text-ink-soft">{photoDetail.relationship}</p>
        <p className="mt-1 text-sm text-ink-faint">{photoDetail.contract}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="border-tan bg-cream">
          View contract
        </Button>
        <Button type="button" variant="outline" className="border-tan bg-cream">
          <MessageSquare className="h-4 w-4" />
          Send Lena a note
        </Button>
      </div>
    </div>
  )
}

function FoodDetail() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div>
        <p className="font-display text-xl font-bold text-ink">Souvla catering + house bar</p>
        <p className="mt-2 text-base text-ink-soft">Operator is drafting menu options. Estimate is still inside the profit plan, but high enough to confirm before approval.</p>
      </div>
      <Button type="button" variant="outline" className="border-clay/35 bg-cream text-clay-deep">
        Ask Souvla to confirm
      </Button>
    </div>
  )
}

function CheckinDetail() {
  return (
    <div>
      <p className="font-display text-xl font-bold text-ink">House staff check-in</p>
      <p className="mt-2 text-base text-ink-soft">Two house staff are expected to confirm 7 days out. The agent will ask you before any staffing change is accepted.</p>
    </div>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className="mt-2 text-sm leading-6 text-ink">{value}</p>
    </div>
  )
}

function PlanExpanded() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <DetailMetric label="Format" value="Seated founder dinner with one moderated operator roundtable." />
      <DetailMetric label="Run of show" value="Doors at 6 PM, dinner at 7 PM, moderated discussion at 8 PM." />
      <DetailMetric label="Reuse" value="Template based on the last 3 Founder Dinners." />
    </div>
  )
}

function MoneyExpanded() {
  const incomeLines = moneyLines.filter((line) => line.kind === 'income')
  const costLines = moneyLines.filter((line) => line.kind !== 'income')

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-lg border border-tan bg-cream p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">Projected profit</p>
            <p className="mt-2 font-display text-3xl font-bold text-forest sm:text-4xl">{formatCents(moneySummary.projectedProfitCents)}</p>
          </div>
          <span className="rounded-full border border-forest/20 bg-forest-tint px-3 py-1.5 text-xs font-semibold text-forest">{moneySummary.confidenceLabel}</span>
        </div>

        <div className="mt-6 space-y-3">
          <MoneyLineGroup title="Income" lines={incomeLines} />
          <MoneyLineGroup title="Costs" lines={costLines} />
          <div className="border-t border-tan pt-4">
            <MoneyRow label="Total income" amount={moneySummary.totalIncomeCents} />
            <MoneyRow label="Total cost" amount={-moneySummary.totalCostCents} />
            <MoneyRow label="Projected profit" amount={moneySummary.projectedProfitCents} isStrong />
          </div>
        </div>
      </div>

      <aside className="rounded-lg border border-ochre/25 bg-ochre-tint/45 p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">Money watch</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DetailStat label="Break-even" value={`${moneySummary.breakEvenTickets} tickets`} />
          <DetailStat label="Margin" value={moneySummary.marginLabel} />
        </div>
        <p className="mt-5 text-sm font-semibold text-ink">{moneySummary.watchTitle}</p>
        <p className="mt-2 text-sm leading-6 text-ink-soft">{moneySummary.watchBody}</p>
        <Button type="button" variant="outline" className="mt-5 w-full border-ochre/35 bg-cream text-ink">
          {moneySummary.watchCta}
        </Button>
      </aside>
    </div>
  )
}

function MoneyLineGroup({ title, lines }: { title: string; lines: typeof moneyLines }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
      <div className="space-y-1">
        {lines.map((line) => (
          <MoneyRow key={line.label} label={line.label} amount={line.amountCents} detail={line.detail} />
        ))}
      </div>
    </div>
  )
}

function MoneyRow({ label, amount, detail, isStrong = false }: { label: string; amount: number; detail?: string; isStrong?: boolean }) {
  return (
    <div className={cn('grid gap-2 py-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]', isStrong && 'text-base font-semibold text-ink')}>
      <span className="min-w-0 text-ink-soft">
        {label}
        {detail ? <span className="ml-2 text-xs text-ink-faint">({detail})</span> : null}
      </span>
      <span className={cn('font-mono font-semibold tabular-nums text-ink', amount < 0 && !isStrong && 'text-ink-soft')}>{formatCents(amount)}</span>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-tan bg-cream/80 p-3">
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

function GuestsExpanded() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="rounded-lg border border-tan bg-cream p-5">
        <p className="font-display text-2xl font-bold text-ink">
          {guestSummary.confirmed} confirmed of {guestSummary.target}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          {guestSummary.remaining} capacity remaining. Selling steadily over the last 5 days: {guestSummary.velocity.join(', ')}.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {guestSummary.people.map((person) => (
            <div key={person} className="rounded-lg border border-tan bg-cream-deep/35 px-3 py-2 text-sm text-ink-soft">
              {person}
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" className="mt-5 border-tan bg-cream">
          View guest list
        </Button>
      </div>

      <aside className="rounded-lg border border-tan bg-cream p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">Reminders</p>
        <div className="mt-4 space-y-3">
          {guestSummary.reminders.map((reminder) => (
            <div key={reminder.label} className="rounded-lg border border-tan bg-cream-deep/35 p-3">
              <p className="text-xs font-semibold text-ink">{reminder.label}</p>
              <p className="mt-1 text-sm text-ink-soft">{reminder.copy}</p>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" className="mt-5 w-full border-tan bg-cream">
          Edit reminder copy
        </Button>
        <p className="mt-5 text-sm leading-6 text-ink-soft">{guestSummary.checkin}</p>
      </aside>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: StatusTone; children: string }) {
  return (
    <span className={cn('inline-flex w-fit items-center rounded-full px-3 py-1.5 text-[11px] font-bold uppercase leading-none tracking-[0.08em]', pillClass(tone))}>
      {children}
    </span>
  )
}

function PlaceholderEventState({ event, onReturn }: { event: MockupEventCard; onReturn: () => void }) {
  return (
    <section className="rounded-lg border border-tan bg-cream p-6 shadow-card sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-faint">
        {event.dateLabel} · {event.metro}
      </p>
      <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">{event.title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Phase 1 fully models Founder Dinner. This event card is interactive to show how recurring events would populate the same booking page pattern.
      </p>
      <Button type="button" variant="outline" className="mt-6 border-tan bg-cream" onClick={onReturn}>
        Return to Founder Dinner
      </Button>
    </section>
  )
}

function ApprovalModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/30 px-4 py-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="approval-modal-title">
      <div className="w-full max-w-md rounded-lg border border-tan bg-cream p-5 shadow-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-clay-deep">Approval confirmation</p>
            <h2 id="approval-modal-title" className="mt-3 font-display text-2xl font-bold text-ink">Approve hold?</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-tan p-2 text-ink-soft transition-smooth hover:bg-cream-deep hover:text-ink" aria-label="Close approval modal">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-soft">
          You will commit the $1,650 deposit for The Pearl SF. It is refundable until Jun 21. This Phase 1 mockup does not create a real approval record.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="border-tan bg-cream" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="bg-clay text-cream hover:bg-clay-deep" onClick={onClose}>
            Approve & sign
          </Button>
        </div>
      </div>
    </div>
  )
}

function dotClass(tone: StatusTone) {
  if (tone === 'settled' || tone === 'track') return 'bg-forest'
  if (tone === 'drafting') return 'bg-ochre'
  if (tone === 'action') return 'bg-clay'
  return 'bg-ink-faint'
}

function attentionClass(tone: StatusTone) {
  if (tone === 'settled' || tone === 'track') return 'text-forest'
  if (tone === 'drafting') return 'text-ochre'
  if (tone === 'action') return 'text-clay-deep'
  return 'text-ink-faint'
}

function pillClass(tone: StatusTone) {
  if (tone === 'settled' || tone === 'track') return 'bg-forest-tint text-forest'
  if (tone === 'drafting') return 'bg-ochre-tint text-ochre'
  if (tone === 'action') return 'bg-clay-tint text-clay-deep'
  return 'bg-cream-deep text-ink'
}
