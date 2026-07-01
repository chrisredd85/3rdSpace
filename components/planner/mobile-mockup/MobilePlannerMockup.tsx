'use client'

import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DollarSign,
  Flower2,
  Mail,
  Menu,
  MessageSquare,
  Music,
  Pencil,
  Send,
  ShieldCheck,
  UtensilsCrossed,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { mobileMockupSpacing as spacing } from './mobileMockupSpacing'

type MockupSection =
  | 'planner'
  | 'approvals'
  | 'messages'
  | 'vendors'
  | 'outreach'
  | 'analytics'
  | 'ticketing'
  | 'billing'
  | 'settings'

type MockupView =
  | 'new-plan'
  | 'planner'
  | 'brief'
  | 'venues'
  | 'venue-detail'
  | 'budget'
  | 'draft'
  | 'approval'
  | 'deposit'
  | 'sent'
  | 'reply'
  | 'vendor-detail'
  | 'outreach-thread'

type StatusTone = 'clay' | 'forest' | 'ochre' | 'muted' | 'brick'

const pendingReviewCount = 3

function isMockupView(value: string | null): value is MockupView {
  return (
    value === 'new-plan' ||
    value === 'planner' ||
    value === 'brief' ||
    value === 'venues' ||
    value === 'venue-detail' ||
    value === 'budget' ||
    value === 'draft' ||
    value === 'approval' ||
    value === 'deposit' ||
    value === 'sent' ||
    value === 'reply' ||
    value === 'vendor-detail' ||
    value === 'outreach-thread'
  )
}

interface FlowStep {
  id: MockupView
  label: string
}

interface AppSectionLink {
  id: MockupSection
  label: string
  href: string
}

const appSections: AppSectionLink[] = [
  { id: 'planner', label: 'Summer mixer', href: '/mobile-mockup/planner' },
  { id: 'approvals', label: 'Review queue', href: '/mobile-mockup/approvals' },
  { id: 'messages', label: 'Inbox', href: '/mobile-mockup/messages' },
  { id: 'vendors', label: 'Vendors', href: '/mobile-mockup/vendors' },
  { id: 'outreach', label: 'Outreach', href: '/mobile-mockup/outreach' },
  { id: 'analytics', label: 'Analytics', href: '/mobile-mockup/analytics' },
  { id: 'ticketing', label: 'Ticketing', href: '/mobile-mockup/ticketing' },
  { id: 'billing', label: 'Billing', href: '/mobile-mockup/billing' },
  { id: 'settings', label: 'Settings', href: '/mobile-mockup/settings' },
]

const flowSteps: FlowStep[] = [
  { id: 'planner', label: 'Plan' },
  { id: 'brief', label: 'Brief' },
  { id: 'venues', label: 'Venues' },
  { id: 'budget', label: 'Budget' },
  { id: 'draft', label: 'Draft' },
  { id: 'approval', label: 'Approval' },
  { id: 'deposit', label: 'Deposit' },
  { id: 'sent', label: 'Sent' },
  { id: 'reply', label: 'Reply' },
]

const venues = [
  {
    name: 'The Pearl',
    detail: 'Dogpatch · fits 150',
    status: 'Draft ready',
    tone: 'forest' as StatusTone,
  },
  {
    name: 'Verdi Club',
    detail: 'Mission · capacity 140',
    status: 'Waiting',
    tone: 'ochre' as StatusTone,
  },
  {
    name: 'Stable Cafe',
    detail: 'Mission · capacity 130',
    status: 'Budget check',
    tone: 'ochre' as StatusTone,
  },
  {
    name: 'Arcana',
    detail: 'Mission · capacity 160',
    status: 'Hold possible',
    tone: 'forest' as StatusTone,
  },
]

const vendors = [
  {
    name: 'Bay Supper Club',
    detail: 'Catering · SF',
    status: 'Quote ready',
    tone: 'forest' as StatusTone,
    icon: UtensilsCrossed,
  },
  {
    name: 'North Bay AV',
    detail: 'Audio and lighting · Bay Area',
    status: 'Checking',
    tone: 'ochre' as StatusTone,
    icon: Music,
  },
  {
    name: 'Iris Photo',
    detail: 'Event photographer · Mission',
    status: 'Draft ready',
    tone: 'forest' as StatusTone,
    icon: Camera,
  },
  {
    name: 'Petal Supply',
    detail: 'Florals · Oakland',
    status: 'Optional',
    tone: 'muted' as StatusTone,
    icon: Flower2,
  },
]

const threadRows = [
  {
    name: 'The Pearl',
    detail: 'Replied 8:42 AM',
    status: 'Decision ready',
    tone: 'forest' as StatusTone,
  },
  {
    name: 'Verdi Club',
    detail: 'Declined yesterday',
    status: 'Declined',
    tone: 'brick' as StatusTone,
  },
  {
    name: 'Stable Cafe',
    detail: 'Draft waiting',
    status: 'Draft',
    tone: 'muted' as StatusTone,
  },
  {
    name: 'Arcana',
    detail: 'Follow-up queued',
    status: 'Follow-up',
    tone: 'forest' as StatusTone,
  },
]

const toneClass: Record<StatusTone, string> = {
  clay: 'border-clay/25 bg-clay-tint text-clay-deep',
  forest: 'border-forest/20 bg-forest-tint text-forest',
  ochre: 'border-ochre/25 bg-ochre-tint text-ink-soft',
  muted: 'border-tan bg-cream-deep text-ink-soft',
  brick: 'border-brick/25 bg-brick-tint text-brick',
}

export function MobilePlannerMockup({
  activeSection = 'planner',
  initialView = 'planner',
}: {
  activeSection?: MockupSection
  initialView?: MockupView
}) {
  const [view, setView] = useState<MockupView>(initialView)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuTouchStartX, setMenuTouchStartX] = useState<number | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [newPlanDraft, setNewPlanDraft] = useState('')
  const [newPlanStarted, setNewPlanStarted] = useState(false)
  const [sentExtraMessage, setSentExtraMessage] = useState(false)
  const [approvalMode, setApprovalMode] = useState<'all' | 'rules'>('all')
  const [allowFollowups, setAllowFollowups] = useState(true)
  const [allowLogistics, setAllowLogistics] = useState(true)
  const [approvedHold, setApprovedHold] = useState(false)

  function navigate(nextView: MockupView) {
    setView(nextView)
    setIsMenuOpen(false)
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  useEffect(() => {
    if (activeSection !== 'planner') return

    const params = new URLSearchParams(window.location.search)
    const requestedView = params.get('view')
    if (isMockupView(requestedView)) {
      setView(requestedView)
    }
  }, [activeSection])

  function handleSendMessage() {
    if (!messageDraft.trim()) return
    setSentExtraMessage(true)
    setMessageDraft('')
  }

  return (
    <main className="min-h-screen bg-cream text-ink lg:flex lg:justify-center">
      <div className="min-h-screen w-full max-w-[430px] border-x border-transparent bg-cream shadow-none lg:border-tan lg:shadow-card">
        <MockupHeader
          isMenuOpen={isMenuOpen}
          reviewCount={pendingReviewCount}
          onToggleMenu={() => setIsMenuOpen((value) => !value)}
        />

        {isMenuOpen && (
          <MobileNavigationPanel
            activeSection={activeSection}
            activeView={view}
            menuTouchStartX={menuTouchStartX}
            onClose={() => setIsMenuOpen(false)}
            onNavigate={navigate}
            onTouchStart={setMenuTouchStartX}
          />
        )}

        <div className={cn(spacing.pagePaddingX, spacing.pagePaddingBottom, spacing.pagePaddingTop)}>
          {activeSection === 'planner' && view === 'new-plan' && (
            <NewPlanView
              draft={newPlanDraft}
              started={newPlanStarted}
              onDraftChange={setNewPlanDraft}
              onStart={() => setNewPlanStarted(true)}
              onNavigate={navigate}
            />
          )}
          {activeSection === 'planner' && view === 'planner' && (
            <PlannerView
              sentExtraMessage={sentExtraMessage}
              messageDraft={messageDraft}
              onDraftChange={setMessageDraft}
              onSendMessage={handleSendMessage}
              onNavigate={navigate}
            />
          )}
          {activeSection === 'planner' && view === 'brief' && <BriefView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'venues' && <VenuesView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'venue-detail' && <VenueDetailView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'budget' && <BudgetView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'draft' && <DraftView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'approval' && (
            <ApprovalView
              approvalMode={approvalMode}
              allowFollowups={allowFollowups}
              allowLogistics={allowLogistics}
              onApprovalModeChange={setApprovalMode}
              onFollowupsChange={setAllowFollowups}
              onLogisticsChange={setAllowLogistics}
              onNavigate={navigate}
            />
          )}
          {activeSection === 'planner' && view === 'deposit' && <DepositApprovalView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'sent' && <SentView onNavigate={navigate} />}
          {activeSection === 'planner' && view === 'reply' && (
            <ReplyView approvedHold={approvedHold} onApproveHold={() => setApprovedHold(true)} onNavigate={navigate} />
          )}
          {activeSection === 'approvals' && <ApprovalsSection />}
          {activeSection === 'messages' && <MessagesSection />}
          {activeSection === 'vendors' && view === 'vendor-detail' && <VendorDetailView onNavigate={navigate} />}
          {activeSection === 'vendors' && view !== 'vendor-detail' && <VendorsSection onNavigate={navigate} />}
          {activeSection === 'outreach' && view === 'outreach-thread' && <OutreachThreadView onNavigate={navigate} />}
          {activeSection === 'outreach' && view !== 'outreach-thread' && <OutreachSection onNavigate={navigate} />}
          {activeSection === 'analytics' && <AnalyticsSection />}
          {activeSection === 'ticketing' && <TicketingSection />}
          {activeSection === 'billing' && <BillingSection />}
          {activeSection === 'settings' && <SettingsSection />}
        </div>

        <footer className="border-t border-tan px-6 py-6 text-center font-mono text-xs text-ink-faint">
          Local mobile prototype
        </footer>
      </div>

      <aside className="sticky top-8 ml-8 hidden h-fit w-[300px] rounded-lg border border-tan bg-cream-deep p-5 lg:block">
        <p className="label-caps text-clay">Local prototype</p>
        <h2 className="mt-3 font-display text-3xl leading-tight text-ink">Click through the mobile product before committing.</h2>
        <div className="mt-6 grid gap-2">
          {appSections.map((section, index) => (
            <Link
              key={section.id}
              href={section.href}
              className={cn(
                'flex items-center justify-between rounded-md border px-3 py-3 text-left text-sm transition-colors',
                section.id === activeSection
                  ? 'border-clay bg-clay text-primary-foreground'
                  : 'border-tan bg-cream text-ink-soft'
              )}
            >
              <span>{section.label}</span>
              <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
            </Link>
          ))}
        </div>
        {activeSection === 'planner' && (
          <>
            <p className="mt-7 label-caps text-clay">Event states</p>
            <div className="mt-4 grid gap-2">
              {flowSteps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => navigate(step.id)}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-3 py-3 text-left text-sm transition-colors',
                    step.id === view ? 'border-clay bg-clay text-primary-foreground' : 'border-tan bg-cream text-ink-soft'
                  )}
                >
                  <span>{step.label}</span>
                  <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="mt-5 text-sm leading-6 text-ink-soft">Desktop shows this preview rail only for review. The product surface itself stays mobile-width.</p>
      </aside>
    </main>
  )
}

function MockupHeader({
  isMenuOpen,
  reviewCount,
  onToggleMenu,
}: {
  isMenuOpen: boolean
  reviewCount: number
  onToggleMenu: () => void
}) {
  return (
    <header className={cn('border-b border-tan bg-cream pt-[calc(env(safe-area-inset-top)+1.5rem)]', spacing.pagePaddingX, spacing.headerPaddingBottom)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="font-display text-[34px] font-semibold leading-none tracking-tight text-clay"
          aria-label="Go to planner start"
        >
          3rdPlace
        </button>
        <div className="flex items-center gap-2">
          <Link
            href="/mobile-mockup/approvals"
            className={cn(
              'inline-flex min-h-10 items-center justify-center rounded-lg px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors',
              reviewCount > 0
                ? 'border border-clay bg-clay text-primary-foreground'
                : 'border border-clay bg-cream text-clay'
            )}
          >
            Review{reviewCount > 0 ? ` · ${reviewCount}` : ''}
          </Link>
          <button
            type="button"
            onClick={onToggleMenu}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-tan bg-cream-deep text-ink transition-colors hover:bg-cream"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </header>
  )
}

function MobileNavigationPanel({
  activeSection,
  activeView,
  menuTouchStartX,
  onClose,
  onNavigate,
  onTouchStart,
}: {
  activeSection: MockupSection
  activeView: MockupView
  menuTouchStartX: number | null
  onClose: () => void
  onNavigate: (view: MockupView) => void
  onTouchStart: (value: number | null) => void
}) {
  function openEventView(nextView: MockupView) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/mobile-mockup/planner') {
      window.location.href = `/mobile-mockup/planner?view=${nextView}`
      onClose()
      return
    }

    onNavigate(nextView)
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden" aria-label="Mobile navigation panel">
      <button
        type="button"
        className="absolute inset-0 bg-cream/80"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <nav
        className={cn('absolute right-0 top-0 h-full w-[86vw] max-w-[360px] overflow-y-auto border-l border-tan bg-cream pt-[calc(env(safe-area-inset-top)+1.25rem)] shadow-card transition-transform', spacing.pagePaddingX, spacing.panelPaddingBottom)}
        onTouchStart={(event) => onTouchStart(event.touches[0]?.clientX ?? null)}
        onTouchEnd={(event) => {
          const endX = event.changedTouches[0]?.clientX
          if (menuTouchStartX !== null && endX !== undefined && endX - menuTouchStartX > 48) {
            onClose()
          }
          onTouchStart(null)
        }}
      >
        <div className="flex items-center justify-between border-b border-tan pb-5">
          <p className="font-display text-[30px] font-semibold leading-none text-clay">3rdPlace</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-tan bg-cream-deep text-ink"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={spacing.sectionGap}>
          <p className="label-caps text-clay">This event</p>
          <div className={cn(spacing.labelToHeadline, 'divide-y divide-tan border-y border-tan')}>
            <PanelLink href="/mobile-mockup/planner" label="Plan" isActive={activeSection === 'planner' && activeView === 'planner'} onClick={onClose} />
            <PanelLink href="/mobile-mockup/messages" label="Inbox" isActive={activeSection === 'messages'} onClick={onClose} />
            <PanelInternalLink label="Venue pipeline" isActive={activeSection === 'planner' && (activeView === 'venues' || activeView === 'venue-detail')} onClick={() => openEventView('venues')} />
            <PanelInternalLink label="Budget" isActive={activeSection === 'planner' && activeView === 'budget'} onClick={() => openEventView('budget')} />
            <PanelInternalLink label="Outreach drafts" isActive={activeSection === 'planner' && activeView === 'draft'} onClick={() => openEventView('draft')} />
            <PanelInternalLink label="Event record" isActive={activeSection === 'planner' && activeView === 'brief'} onClick={() => openEventView('brief')} />
          </div>
        </div>

        <div className={spacing.sectionGap}>
          <p className="label-caps text-clay">Workspace</p>
          <div className={cn(spacing.labelToHeadline, 'divide-y divide-tan border-y border-tan')}>
            <PanelLink href="/mobile-mockup/new-plan" label="Start new event" isActive={activeSection === 'planner' && activeView === 'new-plan'} onClick={onClose} />
            <PanelLink href="/planner/experiences" label="Experiences" meta="Open on desktop" isActive={false} onClick={onClose} />
            <PanelLink href="/planner/templates" label="Templates" meta="Open on desktop" isActive={false} onClick={onClose} />
            <PanelLink href="/mobile-mockup/vendors" label="Vendors" isActive={activeSection === 'vendors'} onClick={onClose} />
            <PanelLink href="/mobile-mockup/outreach" label="Outreach" isActive={activeSection === 'outreach'} onClick={onClose} />
            <PanelLink href="/planner/payments" label="Payments" meta="Open on desktop" isActive={false} onClick={onClose} />
            <PanelLink href="/mobile-mockup/ticketing" label="Tickets" isActive={activeSection === 'ticketing'} onClick={onClose} />
            <PanelLink href="/mobile-mockup/analytics" label="Analytics" isActive={activeSection === 'analytics'} onClick={onClose} />
            <PanelLink href="/mobile-mockup/billing" label="Billing" isActive={activeSection === 'billing'} onClick={onClose} />
            <PanelLink href="/mobile-mockup/settings" label="Settings" isActive={activeSection === 'settings'} onClick={onClose} />
          </div>
        </div>
      </nav>
    </div>
  )
}

function PanelLink({
  href,
  label,
  meta,
  isActive,
  onClick,
}: {
  href: string
  label: string
  meta?: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        'flex min-h-12 items-center justify-between border-l-2 px-3 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
        isActive ? 'border-l-clay bg-clay-tint text-clay-deep' : 'border-l-transparent text-ink-soft hover:bg-cream-deep'
      )}
    >
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        {meta && <span className="mt-1 block truncate text-[9px] tracking-[0.12em] text-ink-faint">{meta}</span>}
      </span>
      <ChevronRight className="h-4 w-4" />
    </a>
  )
}

function PanelInternalLink({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center justify-between border-l-2 px-3 py-3 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
        isActive ? 'border-l-clay bg-clay-tint text-clay-deep' : 'border-l-transparent text-ink-soft hover:bg-cream-deep'
      )}
    >
      {label}
      <ChevronRight className="h-4 w-4" />
    </button>
  )
}

function PlannerView({
  sentExtraMessage,
  messageDraft,
  onDraftChange,
  onSendMessage,
  onNavigate,
}: {
  sentExtraMessage: boolean
  messageDraft: string
  onDraftChange: (value: string) => void
  onSendMessage: () => void
  onNavigate: (view: MockupView) => void
}) {
  return (
    <section>
      <SectionIntro
        eyebrow="Today"
        title="Summer mixer needs you"
        description="3 approvals are waiting, Verdi Club declined, and 2 updates are informational. Nothing sends, holds, or pays until you approve it."
        titleClassName="text-[27px]"
      />

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/approvals">Review 3 approvals</PrimaryLink>
        <SecondaryButton onClick={() => onNavigate('brief')}>Open event record</SecondaryButton>
      </div>

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Needs your review</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-[1.08] text-ink')}>Three decisions today.</h2>
        </div>
        <div className="divide-y divide-tan">
          <ReviewQueueRow
            icon={<Mail className="h-5 w-5" />}
            label="Send venue outreach"
            detail="The Pearl · first external message"
            status="Draft ready"
            tone="forest"
            onClick={() => onNavigate('draft')}
          />
          <ReviewQueueRow
            icon={<CalendarDays className="h-5 w-5" />}
            label="Place a soft hold"
            detail="Arcana · July 18 · no payment"
            status="Due today"
            tone="ochre"
            onClick={() => onNavigate('reply')}
          />
          <ReviewQueueRow
            icon={<DollarSign className="h-5 w-5" />}
            label="Authorize deposit"
            detail="$1,200 to hold The Pearl"
            status="High stakes"
            tone="clay"
            onClick={() => onNavigate('deposit')}
          />
        </div>
      </Panel>

      <Panel className={cn(spacing.cardGap, 'border-brick/25 bg-brick-tint')}>
        <div className="flex items-start gap-4">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brick/25 bg-cream text-brick">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <p className="label-caps text-brick">Problem</p>
            <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>Verdi Club declined.</h2>
            <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
              3rdPlace prepared two replacement options and has not contacted either one yet.
            </p>
          </div>
        </div>
        <div className={spacing.bodyToAction}>
          <SecondaryButton onClick={() => onNavigate('venues')}>Compare replacements</SecondaryButton>
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="label-caps text-clay">Add instruction</p>
            <h2 className={cn(spacing.labelToHeadline, 'font-display text-[24px] leading-tight text-ink')}>Tell 3rdPlace what changed.</h2>
          </div>
          <StatusPill tone="muted">Private</StatusPill>
        </div>

        <div className={spacing.bodyToAction}>
          <div className={cn('rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
            <textarea
              value={messageDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="Add a constraint, preference, or correction..."
              className="min-h-[88px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[17px] leading-7 text-ink outline-none placeholder:text-ink-faint"
            />
            <div className={cn(spacing.bodyToAction, 'flex items-end justify-between gap-4')}>
              <p className="text-sm font-semibold text-ink-soft">Updates the brief. Does not send externally.</p>
              <button
                type="button"
                onClick={onSendMessage}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-clay px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <EventProgressCard onNavigate={onNavigate} />

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Informational updates</p>
        </div>
        <UpdateRow
          time="10:42 AM"
          title="Stable Cafe asked for the headcount range"
          detail="No approval needed. 3rdPlace is holding the range at 130-160 until you confirm."
        />
        <UpdateRow
          time="9:18 AM"
          title="Budget model refreshed"
          detail="Venue minimums above $8k would leave less than $1,200 buffer."
          isLast
        />
        {sentExtraMessage && (
          <div className={cn('border-t border-tan', spacing.panelHeaderPadding)}>
            <p className="font-mono text-xs text-ink-faint">JUST NOW</p>
            <p className="mt-2 text-base font-bold text-ink">Instruction added</p>
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              Indoor-outdoor flow and a real bar minimum are now part of the brief.
            </p>
          </div>
        )}
      </Panel>
    </section>
  )
}

function NewPlanView({
  draft,
  started,
  onDraftChange,
  onStart,
  onNavigate,
}: {
  draft: string
  started: boolean
  onDraftChange: (value: string) => void
  onStart: () => void
  onNavigate: (view: MockupView) => void
}) {
  return (
    <section>
      <CompactBackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Start event"
        title="Start your next event."
        description="Host profile and approval rules carry forward. Nothing external happens until review."
      />

      <Panel className={cn(spacing.sectionGapTight, spacing.cardPaddingTight)}>
        <p className="label-caps text-clay">Event request</p>
        <div className={cn(spacing.labelToHeadline, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Example: 80-person founder dinner in SF, late July, around $12k..."
            className="min-h-[82px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[17px] leading-7 text-ink outline-none placeholder:text-ink-faint"
          />
          <p className={cn(spacing.headlineToBody, 'text-sm font-semibold text-ink-soft')}>Creates a private plan. No outreach sends from this step.</p>
        </div>

        <div className={spacing.bodyToAction}>
          <CompactPrimaryButton onClick={() => (started ? onNavigate('planner') : onStart())}>
            {started ? 'Open the new plan' : 'Start private plan'}
          </CompactPrimaryButton>
        </div>

        <div className={cn(spacing.labelToHeadline, 'flex flex-wrap gap-2')}>
          <Chip>Rebook founder dinner</Chip>
          <Chip>June rooftop, new date</Chip>
          <Chip>Monthly mixer</Chip>
        </div>
      </Panel>

      <Panel className={cn(spacing.sectionGapTight, spacing.cardPaddingTight)}>
        <p className="label-caps text-clay">Carries forward</p>
        <div className={cn(spacing.labelToHeadline, 'divide-y divide-tan border-y border-tan')}>
          <SimpleRow label="Host profile" value="Maya Chen" />
          <SimpleRow label="Approval default" value="Every send, hold, payment" />
          <SimpleRow label="Ticketing" value="Luma connected" />
        </div>
      </Panel>

      {started && (
        <Panel className={cn(spacing.cardGap, 'border-forest/25 bg-forest-tint')}>
          <p className="label-caps text-forest">Plan started</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>3rdPlace is ready to draft the first plan.</h2>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            The next screen would show assumptions, venues to screen, and the first approval gate.
          </p>
          <p className={cn(spacing.headlineToBody, 'text-sm font-semibold text-forest')}>
            3rdPlace will not contact anyone until you approve the first send.
          </p>
        </Panel>
      )}

      <div className={spacing.sectionGapTight}>
        {started ? (
          <TextButton onClick={() => onNavigate('planner')}>Back to summer mixer</TextButton>
        ) : (
          <CompactSecondaryButton onClick={() => onNavigate('planner')}>Back to summer mixer</CompactSecondaryButton>
        )}
      </div>
    </section>
  )
}

function EventProgressCard({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
      <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="label-caps text-clay">Event status</p>
            <p className={cn(spacing.headlineToBody, 'text-sm leading-6 text-ink-soft')}>Summer mixer · SF · 150 guests · $20k target</p>
          </div>
          <ShieldCheck className="h-6 w-6 text-forest" />
        </div>
      </div>
      <div className="divide-y divide-tan">
        <CompactActionRow
          label="Brief"
          detail="Event facts are usable"
          status="Ready"
          tone="forest"
          icon={<Pencil className="h-5 w-5" />}
          onClick={() => onNavigate('brief')}
        />
        <CompactActionRow
          label="Venues"
          detail="8 places being screened"
          status="In motion"
          tone="forest"
          icon={<Building2 className="h-5 w-5" />}
          onClick={() => onNavigate('venues')}
        />
        <CompactActionRow
          label="Budget"
          detail="$20k target, $2k buffer"
          status="Watch"
          tone="ochre"
          icon={<DollarSign className="h-5 w-5" />}
          onClick={() => onNavigate('budget')}
        />
        <CompactActionRow
          label="Draft"
          detail="The Pearl outreach"
          status="Review"
          tone="clay"
          icon={<Mail className="h-5 w-5" />}
          onClick={() => onNavigate('draft')}
        />
      </div>
    </Panel>
  )
}

function ReviewQueueRow({
  icon,
  label,
  detail,
  status,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  detail: string
  status: string
  tone: StatusTone
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.rowPadding)}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-tan bg-cream-deep text-clay">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[18px] font-semibold leading-tight text-ink">{label}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink-soft">{detail}</span>
          <StatusPill tone={tone}>{status}</StatusPill>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-ink-soft" />
    </button>
  )
}

function UpdateRow({
  time,
  title,
  detail,
  isLast = false,
}: {
  time: string
  title: string
  detail: string
  isLast?: boolean
}) {
  return (
    <div className={cn(spacing.rowPadding, !isLast && 'border-b border-tan')}>
      <p className="font-mono text-xs text-ink-faint">{time}</p>
      <p className={cn(spacing.headlineToBody, 'text-base font-bold text-ink')}>{title}</p>
      <p className="mt-1 text-sm leading-6 text-ink-soft">{detail}</p>
    </div>
  )
}

function BriefView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Event record"
        title="Shared operating context."
        description="This is what 3rdPlace believes about the event. Hosts correct it here before facts are used externally."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className={cn('border-b border-tan', spacing.panelHeaderPadding)}>
          <p className="label-caps text-clay">Confirmed facts</p>
        </div>
        <div className="divide-y divide-tan">
          <BriefFactRow icon={<Pencil className="h-5 w-5" />} label="Event" value="Summer mixer" status="Confirmed" tone="forest" />
          <BriefFactRow icon={<Users className="h-5 w-5" />} label="Guests" value="150" status="Confirmed" tone="forest" />
          <BriefFactRow icon={<DollarSign className="h-5 w-5" />} label="Budget" value="$20k target" status="Confirmed" tone="forest" />
          <BriefFactRow icon={<Building2 className="h-5 w-5" />} label="Location" value="San Francisco" status="Confirmed" tone="forest" />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Inferred assumptions</p>
        <div className={cn(spacing.labelToHeadline, 'flex flex-wrap gap-2')}>
          <Chip>Thursday evening</Chip>
          <Chip>Indoor-outdoor preferred</Chip>
          <Chip>Bar minimum acceptable</Chip>
        </div>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          These are usable for planning, but 3rdPlace should confirm them before any high-stakes action.
        </p>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Used externally</p>
        <div className={cn(spacing.labelToHeadline, 'flex flex-wrap gap-2')}>
          <Chip>Host name</Chip>
          <Chip>Public description</Chip>
          <Chip>Approval required</Chip>
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('planner')}>Save changes</PrimaryButton>
        <SecondaryButton onClick={() => onNavigate('planner')}>Back to plan</SecondaryButton>
      </div>
    </section>
  )
}

function VenuesView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Venues"
        title="Eight places in motion."
        description="The planner view shows operating status instead of a browseable marketplace."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className="divide-y divide-tan">
          {venues.map((venue, index) => (
            <button
              key={venue.name}
              type="button"
              onClick={() => onNavigate(index === 0 ? 'venue-detail' : 'draft')}
              className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.compactRowPadding)}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{venue.name}</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="min-w-0 truncate text-sm text-ink-soft">{venue.detail}</p>
                  <StatusPill tone={venue.tone}>{venue.status}</StatusPill>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-ink-soft" />
            </button>
          ))}
        </div>
      </Panel>

      <div className={spacing.bodyToAction}>
        <PrimaryButton onClick={() => onNavigate('draft')}>Review venue draft</PrimaryButton>
      </div>
    </section>
  )
}

function VenueDetailView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to venues" onClick={() => onNavigate('venues')} />
      <SectionIntro
        eyebrow="Venue detail"
        title="The Pearl is ready."
        description="Every venue drilldown explains fit, risk, and the next approval instead of asking the host to hunt."
      />

      <Panel className={spacing.sectionGap}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Capacity" value="150" />
          <Metric label="Minimum" value="$8k" />
          <Metric label="Neighborhood" value="Dogpatch" />
          <Metric label="Status" value="Ready" />
        </div>

        <div className={cn(spacing.bodyToAction, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <p className="label-caps text-clay">Why it fits</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            Large enough for the guest count, likely inside the venue budget band, and strong for summer mixer flow.
          </p>
        </div>

        <div className={cn(spacing.cardGap, 'rounded-lg border border-tan bg-cream', spacing.cardPaddingTight)}>
          <p className="text-sm font-bold text-ink">Next message</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            Ask for Thursday availability in July, room minimum, deposit window, and whether a 48-hour soft hold is possible.
          </p>
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/planner?view=draft">Use in outreach draft</PrimaryLink>
        <SecondaryButton onClick={() => onNavigate('venues')}>Back to venues</SecondaryButton>
      </div>
    </section>
  )
}

function BudgetView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Budget"
        title="Keep the run inside $20k."
        description="The budget drilldown shows decision impact before the host approves an external move."
      />

      <Panel className={spacing.sectionGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="Target" value="$20,000" />
          <SimpleRow label="Venue range" value="$6k-$9k" />
          <SimpleRow label="Food & bar" value="$8k-$11k" />
          <SimpleRow label="Buffer" value="$2,000" />
        </div>

        <div className={spacing.bodyToAction}>
          <div className="flex h-5 overflow-hidden rounded-md border border-tan bg-cream-deep">
            <div className="w-[35%] bg-clay" />
            <div className="w-[40%] bg-forest" />
            <div className="w-[10%] bg-ochre" />
            <div className="w-[15%] bg-tan" />
          </div>
          <div className="mt-2 grid grid-cols-4 text-center font-mono text-[11px] text-ink-faint">
            <span>35%</span>
            <span>40%</span>
            <span>10%</span>
            <span>15%</span>
          </div>
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="text-sm font-bold text-ink">Decision impact</p>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Approving a hold at The Pearl may move the buffer from $2,000 to $1,200.
        </p>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('draft')}>Ask for lower minimum</PrimaryButton>
        <SecondaryButton onClick={() => onNavigate('planner')}>Back to plan</SecondaryButton>
      </div>
    </section>
  )
}

function DraftView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Outreach draft"
        title="Review before anything sends."
        description="The first external artifact is where identity, facts, and voice get confirmed in context."
      />

      <Panel className={spacing.sectionGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="To" value="The Pearl events team" />
          <SimpleRow label="From" value="3rdPlace for Maya Chen" />
          <SimpleRow label="Ask" value="Thursday hold for 150 guests" />
        </div>

        <div className={cn(spacing.bodyToAction, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <p className="font-sans text-base leading-7 text-ink-soft">
            Hi The Pearl team - I’m helping Maya plan a 150-person summer mixer in San Francisco. Are you holding any
            Thursday evenings in July?
          </p>
        </div>

        <div className={cn(spacing.cardGap, 'flex flex-wrap gap-2')}>
          <Chip>150 guests</Chip>
          <Chip>$20k target</Chip>
          <Chip>Thursday evening</Chip>
          <Chip>Approval required</Chip>
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('approval')}>Approve send</PrimaryButton>
        <SecondaryButton onClick={() => onNavigate('brief')}>Edit draft facts</SecondaryButton>
      </div>
    </section>
  )
}

function ApprovalView({
  approvalMode,
  allowFollowups,
  allowLogistics,
  onApprovalModeChange,
  onFollowupsChange,
  onLogisticsChange,
  onNavigate,
}: {
  approvalMode: 'all' | 'rules'
  allowFollowups: boolean
  allowLogistics: boolean
  onApprovalModeChange: (mode: 'all' | 'rules') => void
  onFollowupsChange: (value: boolean) => void
  onLogisticsChange: (value: boolean) => void
  onNavigate: (view: MockupView) => void
}) {
  return (
    <section>
      <BackButton label="Back to draft" onClick={() => onNavigate('draft')} />
      <SectionIntro
        eyebrow="Approve send"
        title="Let 3rdPlace contact The Pearl."
        description="This is a low-stakes approval: one outbound message, no hold, no booking, no payment."
      />

      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Message summary</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Ask for availability and hold terms.</h2>
        <div className={cn(spacing.bodyToAction, 'divide-y divide-tan border-y border-tan')}>
          <SimpleRow label="Recipient" value="The Pearl events team" />
          <SimpleRow label="Sender" value="3rdPlace for Maya" />
          <SimpleRow label="Action" value="Send one email" />
        </div>
        <p className={cn(spacing.bodyToAction, 'text-base leading-7 text-ink-soft')}>
          Approving this only sends the reviewed draft. Any price, date, hold, or deposit that comes back requires a new approval.
        </p>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Optional rules for this event</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>What may happen after this send?</h2>
        <div className={cn(spacing.bodyToAction, 'grid grid-cols-2 rounded-lg border border-tan bg-cream-deep p-1')}>
          <button
            type="button"
            onClick={() => onApprovalModeChange('all')}
            className={cn(
              'min-h-11 rounded-md px-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors',
              approvalMode === 'all' ? 'bg-clay text-primary-foreground' : 'text-ink-soft hover:bg-cream'
            )}
          >
            Every send
          </button>
          <button
            type="button"
            onClick={() => onApprovalModeChange('rules')}
            className={cn(
              'min-h-11 rounded-md px-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors',
              approvalMode === 'rules' ? 'bg-clay text-primary-foreground' : 'text-ink-soft hover:bg-cream'
            )}
          >
            Within rules
          </button>
        </div>
        <div className={cn(spacing.bodyToAction, 'divide-y divide-tan border-y border-tan')}>
          {approvalMode === 'all' ? (
            <>
              <RuleTextRow label="Follow-ups after 24h" status="Approval required" tone="muted" />
              <RuleTextRow label="Clarifying logistics only" status="Approval required" tone="muted" />
            </>
          ) : (
            <>
              <ToggleRow
                label="Follow-ups after 24h"
                checked={allowFollowups}
                onChange={() => onFollowupsChange(!allowFollowups)}
              />
              <ToggleRow
                label="Clarifying logistics only"
                checked={allowLogistics}
                onChange={() => onLogisticsChange(!allowLogistics)}
              />
            </>
          )}
          <RuleTextRow label="Never accept price/date changes" status="Locked on" tone="forest" />
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('sent')}>Approve this send</PrimaryButton>
      </div>
    </section>
  )
}

function DepositApprovalView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to plan" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Deposit approval"
        title="Authorize the $1,200 deposit."
        description="This is the highest-stakes approval in the mockup. The amount, recipient, deadline, and refund terms must be explicit before action."
      />

      <Panel className={cn(spacing.sectionGap, 'border-clay/30 bg-clay-tint')}>
        <p className="label-caps text-clay">Money movement</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>$1,200 deposit to The Pearl.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          3rdPlace is prepared to route the deposit after approval. Nothing has been paid.
        </p>
      </Panel>

      <Panel className={spacing.cardGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="Recipient" value="The Pearl" />
          <SimpleRow label="Amount" value="$1,200" />
          <SimpleRow label="Deadline" value="Friday, 5 PM" />
          <SimpleRow label="Refund terms" value="50% until June 28" />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Before approving</p>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Re-approval will be required if the amount, date, venue, or refund terms change.
        </p>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => onNavigate('sent')}>Authorize deposit</PrimaryButton>
        <SecondaryLink href="/mobile-mockup/messages">Ask for better terms</SecondaryLink>
        <TextButton onClick={() => onNavigate('planner')}>Decline this hold</TextButton>
      </div>
    </section>
  )
}

function SentView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to approval" onClick={() => onNavigate('approval')} />
      <SectionIntro
        eyebrow="Outreach"
        title="Messages are out. Work is moving."
        description="After approval, the product becomes an operations timeline instead of an idle chat."
      />

      <Panel className={spacing.sectionGap}>
        <TimelineItem icon={<CheckCircle2 className="h-5 w-5" />} time="9:12 AM" title="Sent to The Pearl after your approval" />
        <TimelineItem icon={<CheckCircle2 className="h-5 w-5" />} time="9:14 AM" title="Sent to Verdi Club after your approval" />
        <TimelineItem icon={<ShieldCheck className="h-5 w-5" />} time="Yesterday" title="Sent within your rule: logistics-only follow-up" />
        <TimelineItem icon={<Clock3 className="h-5 w-5" />} time="9:18 AM" title="Stable Cafe draft waiting for approval" isLast />
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SummaryRow icon={<Send className="h-5 w-5" />} label="4 sent" />
        <SummaryRow icon={<Mail className="h-5 w-5" />} label="3 drafts waiting" />
        <SummaryRow icon={<MessageSquare className="h-5 w-5" />} label="1 reply expected today" isLast />
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/messages">Open messages</PrimaryLink>
        <SecondaryButton onClick={() => onNavigate('reply')}>Simulate venue reply</SecondaryButton>
      </div>
    </section>
  )
}

function ReplyView({
  approvedHold,
  onApproveHold,
  onNavigate,
}: {
  approvedHold: boolean
  onApproveHold: () => void
  onNavigate: (view: MockupView) => void
}) {
  return (
    <section>
      <BackButton label="Back to outreach" onClick={() => onNavigate('sent')} />
      <SectionIntro
        eyebrow="Decision"
        title={approvedHold ? 'Hold request approved.' : 'A hold is available.'}
        description={
          approvedHold
            ? 'The next action is queued, and the host can still review any changed terms.'
            : 'The reply is parsed into budget, timeline, risk, and concrete next actions.'
        }
      />

      <Panel className={spacing.sectionGap}>
        <div className="flex gap-3">
          <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clay text-primary-foreground">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <p className="font-bold text-ink">The Pearl replied</p>
            <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
              July 16 is open. $8k venue minimum. Deposit required by Friday.
            </p>
          </div>
        </div>
      </Panel>

      {approvedHold && (
        <div className={cn(spacing.cardGap, spacing.rowPadding, 'rounded-lg border border-forest/25 bg-forest-tint text-sm font-semibold text-forest')}>
          Hold approved. Deposit is the next blocker.
        </div>
      )}

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SummaryRow icon={<DollarSign className="h-5 w-5" />} label="Budget · inside range" />
        <SummaryRow icon={<CalendarDays className="h-5 w-5" />} label="Timeline · deposit decision due Friday" />
        <SummaryRow icon={<AlertTriangle className="h-5 w-5" />} label="Risk · minimum is high but workable" isLast />
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryButton onClick={() => (approvedHold ? onNavigate('deposit') : onApproveHold())}>
          {approvedHold ? 'Authorize the deposit next' : 'Approve hold request'}
        </PrimaryButton>
        <SecondaryLink href="/mobile-mockup/messages">Ask for lower minimum</SecondaryLink>
        <TextButton onClick={() => onNavigate('planner')}>Decline</TextButton>
      </div>
    </section>
  )
}

function ApprovalsSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Review queue"
        title="Approve the moves that need you."
        description="Highest-stakes decisions come first. Each card states what 3rdPlace is prepared to do and what remains blocked."
      />

      <p className={cn(spacing.sectionGap, 'label-caps text-ink-soft')}>3 items · 1 money · 1 hold · 1 message</p>

      <div className={cn(spacing.sectionGap, 'space-y-5')}>
        <ApprovalCard
          title="Authorize $1,200 deposit"
          target="High stakes"
          detail="Prepared to pay The Pearl only after approval. Recipient, amount, deadline, and refund terms must match the card."
          status="Money"
          tone="clay"
        />
        <ApprovalCard
          title="Place a soft hold"
          target="Medium stakes"
          detail="Prepared to ask Arcana to hold July 18. This does not authorize payment or contract acceptance."
          status="Hold"
          tone="ochre"
        />
        <ApprovalCard
          title="Send venue outreach"
          target="Low stakes"
          detail="Prepared to send one reviewed message to The Pearl. Any changed terms require another approval."
          status="Draft"
          tone="forest"
        />
      </div>
    </section>
  )
}

function MessagesSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Messages"
        title="Replies become decisions."
        description="The mobile messages route is not a generic inbox. It is organized around what the host needs to approve next."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {threadRows.map((thread, index) => (
          <ThreadRow
            key={thread.name}
            name={thread.name}
            detail={thread.detail}
            status={thread.status}
            tone={thread.tone}
            isLast={index === threadRows.length - 1}
          />
        ))}
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Latest parsed reply</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>The Pearl has July 16 open.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          $8k minimum, deposit due Friday, and the venue can support 150 guests. The next step is a host decision.
        </p>
      </Panel>
    </section>
  )
}

function VendorsSection({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <SectionIntro
        eyebrow="Vendors"
        title="Vendor work in motion."
        description="The host sees operating status by category, not a marketplace shelf."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        <div className="divide-y divide-tan">
          {vendors.map((vendor, index) => {
            const VendorIcon = vendor.icon

            return (
            <button
              key={vendor.name}
              type="button"
              onClick={() => index === 0 && onNavigate('vendor-detail')}
              className={cn(
                'grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep',
                spacing.compactRowPadding
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
                <VendorIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-[18px] font-semibold leading-tight text-ink">{vendor.name}</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="min-w-0 truncate text-sm text-ink-soft">{vendor.detail}</p>
                  <StatusPill tone={vendor.tone}>{vendor.status}</StatusPill>
                </div>
              </div>
              {index === 0 ? <ChevronRight className="h-4 w-4 text-ink-soft" /> : <span aria-hidden="true" className="h-4 w-4" />}
            </button>
            )
          })}
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Next blocker</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Catering quote needs sign-off.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Bay Supper Club is inside the food budget, but 3rdPlace needs approval before sharing the confirmed headcount.
        </p>
      </Panel>
    </section>
  )
}

function VendorDetailView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to vendors" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Vendor detail"
        title="Bay Supper Club is quote-ready."
        description="Vendor drilldowns show the scope, economics, and exact next approval before 3rdPlace contacts anyone."
      />

      <Panel className={spacing.sectionGap}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Category" value="Catering" />
          <Metric label="Estimate" value="$7.8k" />
          <Metric label="Guests" value="150" />
          <Metric label="Status" value="Quote" />
        </div>

        <div className={cn(spacing.bodyToAction, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <p className="label-caps text-clay">Why it fits</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            Family-style service keeps the room moving, the price leaves budget buffer, and the menu works for mixed dietary needs.
          </p>
        </div>

        <div className={cn(spacing.cardGap, 'rounded-lg border border-tan bg-cream', spacing.cardPaddingTight)}>
          <p className="text-sm font-bold text-ink">Next message</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            Confirm menu range, staffing, tax and service, and whether the quote can hold for 48 hours.
          </p>
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/planner?view=draft">Use in outreach draft</PrimaryLink>
        <SecondaryButton onClick={() => onNavigate('planner')}>Back to vendors</SecondaryButton>
      </div>
    </section>
  )
}

function OutreachSection({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <SectionIntro
        eyebrow="Outreach"
        title="External threads in context."
        description="Outreach is the full operating record: sent drafts, replies, parsed facts, and blocked next moves."
      />

      <Panel className={cn(spacing.sectionGap, spacing.cardPaddingNone)}>
        {threadRows.map((thread, index) => (
          <ThreadRow
            key={thread.name}
            name={thread.name}
            detail={thread.detail}
            status={thread.status}
            tone={thread.tone}
            onClick={index === 0 ? () => onNavigate('outreach-thread') : undefined}
            isLast={index === threadRows.length - 1}
          />
        ))}
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Policy</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Approval required before every send.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          3rdPlace may parse and draft in the background, but the host still approves each outgoing message in this mockup.
        </p>
      </Panel>
    </section>
  )
}

function OutreachThreadView({ onNavigate }: { onNavigate: (view: MockupView) => void }) {
  return (
    <section>
      <BackButton label="Back to outreach" onClick={() => onNavigate('planner')} />
      <SectionIntro
        eyebrow="Thread"
        title="The Pearl reply has a decision."
        description="The thread view keeps source messages and parsed blockers together so the host can audit what 3rdPlace inferred."
      />

      <Panel className={spacing.sectionGap}>
        <TimelineItem icon={<Send className="h-5 w-5" />} time="Yesterday" title="3rdPlace sent the reviewed availability request." />
        <TimelineItem icon={<Mail className="h-5 w-5" />} time="8:42 AM" title="The Pearl replied with July 16, $8k minimum, deposit due Friday." />
        <TimelineItem icon={<ShieldCheck className="h-5 w-5" />} time="8:47 AM" title="3rdPlace parsed the reply into budget, timeline, and risk." isLast />
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SummaryRow icon={<DollarSign className="h-5 w-5" />} label="Budget · inside range" />
        <SummaryRow icon={<CalendarDays className="h-5 w-5" />} label="Decision due Friday" />
        <SummaryRow icon={<AlertTriangle className="h-5 w-5" />} label="Deposit approval is blocked" isLast />
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/planner?view=reply">Review hold decision</PrimaryLink>
        <SecondaryLink href="/mobile-mockup/messages">Open decision inbox</SecondaryLink>
      </div>
    </section>
  )
}

function SettingsSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Settings"
        title="3rdPlace defaults."
        description="Mobile settings should make operating policy auditable without turning setup into a form."
      />

      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Workspace defaults</p>
        <div className={cn(spacing.labelToHeadline, 'divide-y divide-tan border-y border-tan')}>
          <SimpleRow label="Approval default" value="Every action" />
          <SimpleRow label="Ticketing" value="Luma connected" />
          <SimpleRow label="Payment method" value="No card yet" />
          <SimpleRow label="Host identity" value="Maya Chen" />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Mobile scope</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Review here. Edit fully on desktop.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Advanced billing, team permissions, and connected accounts stay on the desktop settings surface for now.
        </p>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/approvals">Review approvals</PrimaryLink>
        <SecondaryLink href="/planner/settings">Edit on desktop</SecondaryLink>
      </div>
    </section>
  )
}

function AnalyticsSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Analytics"
        title="Know what worked."
        description="Analytics should read like event operating intelligence, not a standalone chart dashboard."
      />

      <Panel className={spacing.sectionGap}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="2026 events" value="14" />
          <Metric label="Avg margin" value="18%" />
          <Metric label="Rebook rate" value="64%" />
          <Metric label="Best format" value="Mixer" />
        </div>

        <div className={cn(spacing.bodyToAction, 'rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
          <p className="label-caps text-clay">Agent recommendation</p>
          <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
            Thursday mixers with 120-170 guests returned the strongest margin. Keep venue minimums under $8k and use
            in-house bar where possible.
          </p>
        </div>
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SimpleMetricRow label="Summer mixer" value="$4.8k net" tone="forest" />
        <SimpleMetricRow label="Founder dinner" value="$2.1k net" tone="forest" />
        <SimpleMetricRow label="Rooftop tasting" value="$600 leak" tone="brick" isLast />
      </Panel>
    </section>
  )
}

function TicketingSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Ticketing"
        title="Live event data, not signup homework."
        description="Ticketing belongs here as event-scoped operating intelligence once the host is running a plan."
      />

      <Panel className={spacing.sectionGap}>
        <div className="divide-y divide-tan border-y border-tan">
          <SimpleRow label="Connected" value="Luma" />
          <SimpleRow label="Verified event" value="Summer mixer" />
          <SimpleRow label="Sold" value="92 / 150" />
          <SimpleRow label="Pace" value="8 ahead" />
        </div>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Planner impact</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Attendance is above plan.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          3rdPlace should keep the 150-person venue target and avoid spaces capped below 140.
        </p>
      </Panel>

      <Panel className={spacing.cardGap}>
        <p className="label-caps text-clay">Ticketing setup</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>Connect accounts or import proof.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          Eventbrite and Posh can be linked directly. Luma and Partiful can be brought in with CSV exports or screenshots.
        </p>
        <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
          <PrimaryLink href="/planner/integrations/eventbrite">Connect Eventbrite</PrimaryLink>
          <SecondaryLink href="/planner/integrations/posh">Set up Posh</SecondaryLink>
          <SecondaryLink href="/planner/events/import?source=luma">Import Luma CSV or screenshots</SecondaryLink>
          <SecondaryLink href="/planner/events/import?source=partiful">Import Partiful CSV or screenshots</SecondaryLink>
        </div>
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/planner">Use in planner</PrimaryLink>
        <SecondaryLink href="/mobile-mockup/analytics">View event intelligence</SecondaryLink>
      </div>
    </section>
  )
}

function BillingSection() {
  return (
    <section>
      <SectionIntro
        eyebrow="Billing"
        title="Pay when operations move."
        description="Billing should be quiet and concrete: usage, plan, invoices, and what 3rdPlace has handled."
      />

      <Panel className={spacing.sectionGap}>
        <p className="label-caps text-clay">Current plan</p>
        <h2 className={cn(spacing.labelToHeadline, 'font-display text-[28px] leading-tight text-ink')}>First two events on us.</h2>
        <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>
          One free event remaining. No card required until the host chooses to keep running events through 3rdPlace.
        </p>
      </Panel>

      <Panel className={cn(spacing.cardGap, spacing.cardPaddingNone)}>
        <SimpleMetricRow label="Events handled" value="1 / 2 free" tone="forest" />
        <SimpleMetricRow label="Next charge" value="$0 today" tone="muted" />
        <SimpleMetricRow label="Payment method" value="Not required" tone="muted" isLast />
      </Panel>

      <div className={cn(spacing.bodyToAction, 'grid gap-3')}>
        <PrimaryLink href="/mobile-mockup/planner">Start next run</PrimaryLink>
        <SecondaryLink href="/mobile-mockup/approvals">Review approvals</SecondaryLink>
      </div>
    </section>
  )
}

function SectionIntro({
  eyebrow,
  title,
  description,
  titleClassName,
}: {
  eyebrow: string
  title: string
  description: string
  titleClassName?: string
}) {
  return (
    <div>
      <p className="label-caps text-clay">{eyebrow}</p>
      <h1 className={cn(spacing.labelToHeadline, 'font-display text-[30px] leading-[1.05] text-ink', titleClassName)}>{title}</h1>
      <p className={cn(spacing.headlineToBody, 'text-[16px] leading-[1.5] text-ink-soft')}>{description}</p>
    </div>
  )
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-tan bg-cream shadow-card', spacing.cardPadding, className)}>{children}</div>
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(spacing.backButtonGap, 'inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-clay')}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function CompactBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(spacing.backButtonGapTight, 'inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-clay')}
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}

function BriefFactRow({
  icon,
  label,
  value,
  status,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  status: string
  tone: StatusTone
}) {
  return (
    <div className={cn('grid w-full grid-cols-[30px_1fr_auto] items-center gap-3 text-left', spacing.rowPadding)}>
      <span className="text-clay">{icon}</span>
      <span className="min-w-0 text-base text-ink">
        <span className="font-bold">{label}</span>
        <span className="px-2 text-ink-faint">·</span>
        <span className="text-ink-soft">{value}</span>
      </span>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  )
}

function CompactActionRow({
  icon,
  label,
  detail,
  status,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  detail: string
  status: string
  tone: StatusTone
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('grid w-full grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 text-left transition-colors hover:bg-cream-deep', spacing.rowPadding)}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-tan bg-cream-deep text-clay">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[18px] font-semibold leading-tight text-ink">{label}</span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink-soft">{detail}</span>
          <StatusPill tone={tone}>{status}</StatusPill>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-ink-soft" />
    </button>
  )
}

function SimpleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 text-base', spacing.dividerGap)}>
      <span className="shrink-0 font-bold text-ink">{label}</span>
      <span className="min-w-0 break-words text-right text-ink-soft">{value}</span>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      className={cn('flex w-full items-center justify-between gap-4 text-left disabled:cursor-default', spacing.dividerGap)}
    >
      <span className="text-base text-ink-soft">{label}</span>
      <span
        className={cn(
          'relative h-7 w-12 rounded-full border transition-colors',
          checked ? 'border-clay bg-clay' : 'border-tan bg-cream-deep'
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-primary-foreground transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </span>
    </button>
  )
}

function RuleTextRow({
  label,
  status,
  tone,
}: {
  label: string
  status: string
  tone: StatusTone
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 text-left', spacing.dividerGap)}>
      <span className="text-base text-ink-soft">{label}</span>
      <StatusPill tone={tone}>{status}</StatusPill>
    </div>
  )
}

function TimelineItem({
  icon,
  time,
  title,
  isLast = false,
}: {
  icon: React.ReactNode
  time: string
  title: string
  isLast?: boolean
}) {
  return (
    <div className={cn('grid grid-cols-[32px_1fr] gap-4', !isLast && spacing.dividerGap)}>
      <div className="flex flex-col items-center text-clay">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-clay text-primary-foreground">
          {icon}
        </span>
        {!isLast && <span className="h-10 w-px bg-clay/35" />}
      </div>
      <div>
        <p className="font-mono text-xs text-ink-faint">{time}</p>
        <p className="mt-1 text-base text-ink-soft">{title}</p>
      </div>
    </div>
  )
}

function SummaryRow({
  icon,
  label,
  isLast = false,
}: {
  icon: React.ReactNode
  label: string
  isLast?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-4', spacing.rowPadding, !isLast && 'border-b border-tan')}>
      <span className="text-clay">{icon}</span>
      <span className="text-base font-bold text-ink">{label}</span>
    </div>
  )
}

function ThreadRow({
  name,
  detail,
  status,
  tone,
  onClick,
  isLast = false,
}: {
  name: string
  detail: string
  status: string
  tone: StatusTone
  onClick?: () => void
  isLast?: boolean
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'grid w-full grid-cols-[1fr_auto] items-center gap-3 text-left',
        spacing.rowPadding,
        !isLast && 'border-b border-tan'
      )}
    >
      <div className="min-w-0">
        <p className="font-display text-xl font-semibold text-ink">{name}</p>
        <p className="mt-1 truncate text-sm text-ink-soft">{detail}</p>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <StatusPill tone={tone}>{status}</StatusPill>
        {onClick && <ChevronRight className="h-4 w-4 text-ink-soft" />}
      </div>
    </Comp>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('rounded-lg border border-tan bg-cream-deep', spacing.cardPaddingTight)}>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className={cn(spacing.headlineToBody, 'font-display text-xl font-semibold leading-tight text-ink')}>{value}</p>
    </div>
  )
}

function ApprovalCard({
  title,
  target,
  detail,
  status,
  tone,
}: {
  title: string
  target: string
  detail: string
  status: string
  tone: StatusTone
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-caps text-clay">{target}</p>
          <h2 className={cn(spacing.labelToHeadline, 'font-display text-[26px] leading-tight text-ink')}>{title}</h2>
        </div>
        <StatusPill tone={tone}>{status}</StatusPill>
      </div>
      <p className={cn(spacing.headlineToBody, 'text-base leading-7 text-ink-soft')}>{detail}</p>
      <div className={cn(spacing.bodyToAction, 'grid grid-cols-2 gap-3')}>
        <button
          type="button"
          className="h-12 rounded-lg bg-clay px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-clay-deep"
        >
          Review terms
        </button>
        <button
          type="button"
          className="h-12 rounded-lg border border-tan bg-cream-deep px-4 text-sm font-bold text-ink-soft transition-colors hover:bg-cream"
        >
          Not now
        </button>
      </div>
    </Panel>
  )
}

function SimpleMetricRow({
  label,
  value,
  tone,
  isLast = false,
}: {
  label: string
  value: string
  tone: StatusTone
  isLast?: boolean
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', spacing.rowPadding, !isLast && 'border-b border-tan')}>
      <span className="font-display text-xl font-semibold text-ink">{label}</span>
      <StatusPill tone={tone}>{value}</StatusPill>
    </div>
  )
}

function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span className={cn('whitespace-nowrap rounded-full border px-3 py-1 text-center text-[11px] font-semibold', toneClass[tone])}>
      {children}
    </span>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-tan bg-cream-deep px-3 py-2 text-sm font-semibold text-ink-soft">
      {children}
    </span>
  )
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-14 w-full items-center justify-center rounded-lg bg-clay px-5 text-base font-bold text-primary-foreground transition-colors hover:bg-clay-deep"
    >
      {children}
    </button>
  )
}

function CompactPrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-clay px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-clay-deep"
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-14 w-full items-center justify-center rounded-lg border border-clay bg-transparent px-5 text-base font-bold text-clay transition-colors hover:bg-clay-tint"
    >
      {children}
    </button>
  )
}

function CompactSecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-clay bg-transparent px-5 text-sm font-bold text-clay transition-colors hover:bg-clay-tint"
    >
      {children}
    </button>
  )
}

function PrimaryLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-14 w-full items-center justify-center rounded-lg bg-clay px-5 text-base font-bold text-primary-foreground transition-colors hover:bg-clay-deep"
    >
      {children}
    </Link>
  )
}

function SecondaryLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-14 w-full items-center justify-center rounded-lg border border-clay bg-transparent px-5 text-base font-bold text-clay transition-colors hover:bg-clay-tint"
    >
      {children}
    </Link>
  )
}

function TextButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg text-base font-bold text-clay transition-colors hover:bg-clay-tint"
    >
      {icon}
      {children}
    </button>
  )
}
