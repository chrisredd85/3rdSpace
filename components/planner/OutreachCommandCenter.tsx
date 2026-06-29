'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Inbox,
  Loader2,
  Mail,
  MessageSquareText,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type GmailAccount = {
  id: string
  provider: string
  email_address: string
  created_at: string
  token_expires_at: string | null
}

type GmailOutreachMessage = {
  id: string
  direction: string
  subject: string
  body_text: string
  from: string | null
  gmail_message_id: string | null
  gmail_thread_id: string | null
  sent_at: string | null
  received_at: string | null
}

type GmailOutreachThread = {
  id: string
  plan_id: string
  target_name: string
  target_type: string
  target_email: string | null
  state: string
  needs_attention: boolean
  last_event_at: string
  last_inbound_at: string | null
  last_outbound_at: string | null
  messages: GmailOutreachMessage[]
}

type GmailApprovalState = {
  account: GmailAccount | null
  approval: { id: string; status: string } | null
  approvalMessageId: string | null
  planId: string | null
  threads: GmailOutreachThread[]
}

type TargetDraft = {
  kind: 'venue' | 'vendor'
  name: string
  email: string
}

type ThreadStats = {
  sent: number
  waiting: number
  replied: number
  needsAttention: number
}

const initialTargets: TargetDraft[] = [
  { kind: 'venue', name: '', email: '' },
]

export function OutreachCommandCenter() {
  const [state, setState] = useState<GmailApprovalState | null>(null)
  const [targets, setTargets] = useState<TargetDraft[]>(initialTargets)
  const [subject, setSubject] = useState('Happy hour partnership inquiry')
  const [bodyText, setBodyText] = useState(defaultBodyText())
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null)
  const [showCustomComposer, setShowCustomComposer] = useState(false)
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [partnerFilter, setPartnerFilter] = useState<'all' | 'venue' | 'vendor'>('all')
  const [error, setError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/planner/outreach/gmail-approval', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load Gmail outreach')
      setState(payload)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Gmail outreach')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const connectedEmail = state?.account?.email_address ?? null
  const planSearchHref = state?.planId ? `/planner/outreach-search?plan=${encodeURIComponent(state.planId)}` : '/planner/outreach-search'
  const approvalsHref = state?.planId ? `/planner?plan=${encodeURIComponent(state.planId)}&tab=approvals` : '/planner?tab=approvals'
  const currentApprovalHref = state?.planId && state.approvalMessageId
    ? `/planner?plan=${encodeURIComponent(state.planId)}&tab=approvals&msg=${encodeURIComponent(state.approvalMessageId)}`
    : approvalsHref
  const threads = useMemo(() => state?.threads ?? [], [state?.threads])
  const filteredThreads = useMemo(() => {
    if (partnerFilter === 'all') return threads
    return threads.filter((thread) => normalizeTargetType(thread.target_type) === partnerFilter)
  }, [partnerFilter, threads])
  const stats = useMemo(() => summarizeThreads(threads), [threads])
  const replyThreads = useMemo(
    () => threads.filter((thread) => Boolean(thread.last_inbound_at) || thread.messages.some((message) => message.direction === 'inbound')),
    [threads]
  )
  const readyThreadCount = useMemo(() => threads.filter((thread) => !thread.needs_attention).length, [threads])
  const topReplyThread = replyThreads.find((thread) => !thread.needs_attention) ?? replyThreads[0] ?? null

  const canCreateApproval = useMemo(() => {
    return Boolean(
      connectedEmail &&
      subject.trim().length >= 3 &&
      bodyText.trim().length >= 20 &&
      targets.some((target) => target.name.trim() && isValidEmail(target.email.trim()))
    )
  }, [bodyText, connectedEmail, subject, targets])

  async function createApproval() {
    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch('/api/planner/outreach/gmail-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: targets.filter((target) => target.name.trim() && target.email.trim()),
          subject,
          bodyText,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to create outreach approval')
      window.location.href = payload.redirect_url ?? approvalsHref
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create outreach approval')
    } finally {
      setIsCreating(false)
    }
  }

  async function syncThread(threadId: string) {
    setBusyThreadId(threadId)
    setError(null)
    try {
      const response = await fetch(`/api/planner/outreach/gmail-approval/threads/${threadId}/sync`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to sync Gmail thread')
      await loadState()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Unable to sync Gmail thread')
    } finally {
      setBusyThreadId(null)
    }
  }

  async function markHandled(threadId: string) {
    setBusyThreadId(threadId)
    setError(null)
    try {
      const response = await fetch(`/api/planner/outreach/gmail-approval/threads/${threadId}/modify`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to mark thread handled')
      await loadState()
    } catch (modifyError) {
      setError(modifyError instanceof Error ? modifyError.message : 'Unable to mark thread handled')
    } finally {
      setBusyThreadId(null)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 pb-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Outreach {state?.planId ? '· active planner record' : ''}
            </p>
            <h1 className="mt-4 font-display text-5xl font-semibold tracking-normal text-foreground sm:text-6xl">Outreach</h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg">
              The agent finds partners, prepares messages, and waits for your approval before anything sends.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={planSearchHref}>
                <Search className="h-4 w-4" />
                Find partners
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/planner/settings/integrations">
                <ShieldCheck className="h-4 w-4" />
                Gmail settings
              </Link>
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive" role="alert">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <Card className="border-border bg-card shadow-sm">
            <CardContent className="flex min-h-36 items-center gap-3 pt-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading outreach workspace
            </CardContent>
          </Card>
        ) : !connectedEmail ? (
          <Card className="border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Mail className="h-5 w-5 text-primary" />
                Connect Gmail first
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Connect Gmail in settings so 3rdPlace can send approved outreach, read replies, and mark handled threads.
              </p>
              <Button asChild>
                <Link href="/api/integrations/gmail/connect?returnTo=/planner/outreach">
                  Connect Gmail
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-10">
            <section className="grid overflow-hidden rounded-md border border-border bg-card shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.36fr)]">
              <div className="p-6 sm:p-8 lg:p-10">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Agent proposal · awaiting you
                </p>
                <h2 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-tight text-foreground sm:text-5xl">
                  {buildProposalHeadline(state?.approval ?? null, threads)}
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-8 text-muted-foreground">
                  {buildProposalDetail(state?.approval ?? null, stats)}
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                  {state?.approval ? (
                    <Button asChild size="lg">
                      <Link href={currentApprovalHref}>
                        Review outreach batch
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="lg">
                      <Link href={planSearchHref}>
                        Ask agent to find partners
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="lg">
                    <Link href={approvalsHref}>Open approvals</Link>
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowCustomComposer(true)}
                    className="w-fit text-sm font-semibold text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    Add a known place
                  </button>
                </div>
                <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  No message sends without approval.
                </p>
              </div>
              <div className="border-t border-border p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Batch summary</p>
                <div className="mt-7 space-y-5">
                  <SummaryLine label="Recipients" value={threads.length ? formatTargetCountsFromThreads(threads) : 'No sent threads'} />
                  <SummaryLine label="Intent" value={state?.approval ? 'Partner outreach' : 'Discovery needed'} />
                  <SummaryLine label="Channel" value="Gmail · your account" />
                  <SummaryLine label="Sender" value={connectedEmail} />
                  <SummaryLine label="Status" value={state?.approval ? titleize(state.approval.status) : 'No batch waiting'} valueClassName={state?.approval ? 'text-primary' : undefined} />
                </div>
              </div>
            </section>

            <section>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Agent-tracked partners</p>
                  <h2 className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground">The outreach rows the agent is watching</h2>
                </div>
                <div className="inline-flex w-fit rounded-md border border-border bg-card p-1" aria-label="Filter outreach partners">
                  {(['all', 'venue', 'vendor'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setPartnerFilter(filter)}
                      className={`rounded-sm px-4 py-2 text-sm font-semibold transition-colors ${
                        partnerFilter === filter
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {filter === 'all' ? 'All' : filter === 'venue' ? 'Venues' : 'Vendors'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-6 overflow-hidden rounded-md border border-border bg-card">
                {filteredThreads.length ? (
                  filteredThreads.map((thread, index) => (
                    <PartnerOutreachRow
                      key={thread.id}
                      index={index}
                      thread={thread}
                      isExpanded={expandedThreadId === thread.id}
                      busyThreadId={busyThreadId}
                      onToggle={() => setExpandedThreadId((current) => current === thread.id ? null : thread.id)}
                      onSync={syncThread}
                      onMarkHandled={markHandled}
                    />
                  ))
                ) : threads.length ? (
                  <div className="p-8 sm:p-10">
                    <p className="font-display text-3xl font-semibold text-foreground">No {partnerFilter === 'venue' ? 'venue' : 'vendor'} rows yet.</p>
                    <p className="mt-3 max-w-2xl text-base leading-8 text-muted-foreground">
                      Switch filters or ask the agent to expand the partner search before creating a new approval batch.
                    </p>
                    <Button asChild className="mt-6">
                      <Link href={planSearchHref}>
                        Find more partners
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="p-8 sm:p-10">
                    <p className="font-display text-3xl font-semibold text-foreground">No partner rows yet.</p>
                    <p className="mt-3 max-w-2xl text-base leading-8 text-muted-foreground">
                      Start with discovery so 3rdPlace can rank venues and vendors, resolve contact status, and create an approval batch from real candidates.
                    </p>
                    <Button asChild className="mt-6">
                      <Link href={planSearchHref}>
                        Find partners
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </section>

            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Proposed outreach batch</p>
              <h2 className="mt-3 font-display text-4xl font-semibold leading-tight text-foreground">
                {state?.approval ? 'Waiting on your approval' : 'No batch is waiting right now'}
              </h2>
              <Card className="mt-6 border-primary/30 bg-card shadow-sm">
                <CardContent className="space-y-6 p-6 sm:p-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Message intent</p>
                      <p className="mt-3 max-w-3xl text-xl leading-8 text-foreground">
                        {state?.approval
                          ? 'Review the current partner outreach approval before Gmail sends.'
                          : 'Ask venues and vendors for availability, pricing, terms, and the best next step after discovery creates a batch.'}
                      </p>
                    </div>
                    <StatusChip tone={state?.approval ? 'clay' : 'muted'}>
                      {state?.approval ? 'Awaiting approval' : 'No approval'}
                    </StatusChip>
                  </div>
                  <div className="grid gap-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryLine label="Event" value={state?.planId ? 'Selected planner record' : 'No plan selected'} />
                    <SummaryLine label="Recipients" value={threads.length ? formatTargetCountsFromThreads(threads) : 'Discovery pending'} />
                    <SummaryLine label="Reply-to" value={connectedEmail} />
                    <SummaryLine label="Approval" value={state?.approval ? titleize(state.approval.status) : 'Not created'} />
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    {state?.approval ? (
                      <Button asChild>
                        <Link href={currentApprovalHref}>
                          Review approval
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button asChild>
                        <Link href={planSearchHref}>
                          Create batch from discovery
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      No booking, payment, hold, or message executes from this page without approval.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Inbox className="h-5 w-5 text-primary" />
                    Already sent · synced from Gmail
                  </CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Threads become the source record for replies, parsed terms, and follow-up approvals.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {threads.length ? (
                    threads.map((thread) => (
                      <ThreadCard
                        key={thread.id}
                        thread={thread}
                        busyThreadId={busyThreadId}
                        onSync={syncThread}
                        onMarkHandled={markHandled}
                      />
                    ))
                  ) : (
                    <EmptyPanel text="No sent outreach yet. Create a batch, approve it, then return here to sync replies." />
                  )}
                </CardContent>
              </Card>

              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <MessageSquareText className="h-5 w-5 text-primary" />
                    Agent recommendation
                  </CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    The agent compares replies, flags terms, and creates the next approval. This panel only uses synced reply data.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {topReplyThread ? (
                    <AgentRecommendationCard thread={topReplyThread} replyCount={replyThreads.length} />
                  ) : (
                    <EmptyPanel text="No replies parsed yet. Sync Gmail after messages send; the recommendation appears once a partner replies." />
                  )}
                  <Button asChild variant="outline">
                    <Link href="/planner/experiences">
                      Open event records
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </section>

            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="border-b border-border">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-xl">Advanced custom outreach</CardTitle>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      Use this only for a known venue or vendor that discovery did not find. The output is still an approval, not a direct send.
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setShowCustomComposer((current) => !current)}>
                    {showCustomComposer ? 'Hide composer' : 'Open custom composer'}
                  </Button>
                </div>
              </CardHeader>
              {showCustomComposer ? (
                <CardContent className="space-y-5 pt-6">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Custom batch details</p>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">Build a partner outreach batch</h2>
                  </div>
                  <div className="rounded-md border border-border bg-background/60 p-4 text-sm leading-relaxed text-muted-foreground">
                    Add venues and vendors to one approval batch. 3rdPlace sends only after approval, then compares replies by availability,
                    fit, pricing, and next step before recommending the best choices.
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {targets.map((target, index) => (
                      <div key={index} className="rounded-md border border-border bg-background/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Partner {index + 1}
                          </p>
                          {targets.length > 1 ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              aria-label={`Remove partner ${index + 1}`}
                              onClick={() => removeTarget(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-3">
                          <Field label="Partner type">
                            <select
                              value={target.kind}
                              onChange={(event) => updateTarget(index, 'kind', event.target.value)}
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <option value="venue">Venue</option>
                              <option value="vendor">Vendor</option>
                            </select>
                          </Field>
                          <Field label="Partner name">
                            <Input
                              value={target.name}
                              onChange={(event) => updateTarget(index, 'name', event.target.value)}
                              placeholder={target.kind === 'vendor' ? 'Vendor name' : 'Venue name'}
                            />
                          </Field>
                          <Field label="Email">
                            <Input
                              value={target.email}
                              onChange={(event) => updateTarget(index, 'email', event.target.value)}
                              placeholder="venue@example.com"
                              inputMode="email"
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" onClick={addTarget} disabled={targets.length >= 6} className="w-fit">
                    <Plus className="h-4 w-4" />
                    Add venue or vendor
                  </Button>

                  <Field label="Subject">
                    <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
                  </Field>

                  <Field label="Message preview">
                    <Textarea
                      value={bodyText}
                      onChange={(event) => setBodyText(event.target.value)}
                      className="min-h-56"
                    />
                  </Field>

                  <div className="rounded-md border border-border bg-background/60 p-4 text-sm leading-relaxed text-muted-foreground">
                    The planner will create one approval card for the full batch. Sending happens only after the host approves it.
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Button type="button" onClick={createApproval} disabled={!canCreateApproval || isCreating}>
                      {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Create planner approval
                    </Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </div>
  )

  function updateTarget(index: number, field: keyof TargetDraft, value: string) {
    setTargets((current) => current.map((target, targetIndex) => {
      if (targetIndex !== index) return target
      if (field === 'kind') return { ...target, kind: value === 'vendor' ? 'vendor' : 'venue' }
      return { ...target, [field]: value }
    }))
  }

  function addTarget() {
    setTargets((current) => current.length >= 6 ? current : [...current, { kind: 'venue', name: '', email: '' }])
  }

  function removeTarget(index: number) {
    setTargets((current) => current.length <= 1 ? current : current.filter((_target, targetIndex) => targetIndex !== index))
  }
}

function PartnerOutreachRow({
  index,
  thread,
  isExpanded,
  busyThreadId,
  onToggle,
  onSync,
  onMarkHandled,
}: {
  index: number
  thread: GmailOutreachThread
  isExpanded: boolean
  busyThreadId: string | null
  onToggle: () => void
  onSync: (threadId: string) => void
  onMarkHandled: (threadId: string) => void
}) {
  const latestMessage = thread.messages[thread.messages.length - 1]
  const outboundMessage = thread.messages.find((message) => message.direction === 'outbound')
  const inboundMessages = thread.messages.filter((message) => message.direction === 'inbound')
  const latestReply = inboundMessages[inboundMessages.length - 1]
  const hasReply = Boolean(latestReply)
  const statusLabel = hasReply ? 'Replied' : thread.needs_attention ? 'Needs review' : 'Waiting'

  return (
    <article className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-4 p-5 text-left transition-colors hover:bg-background/70 sm:grid-cols-[4rem_minmax(0,1fr)_9rem] sm:p-7"
        aria-expanded={isExpanded}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-background font-mono text-sm text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-3xl font-semibold leading-tight text-foreground">{thread.target_name}</span>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {thread.target_type} · {thread.state.replace(/_/g, ' ')}
            </span>
          </span>
          <span className="mt-3 block text-base leading-7 text-muted-foreground">
            {latestReply?.body_text
              ? truncate(latestReply.body_text, 150)
              : outboundMessage?.body_text
                ? truncate(outboundMessage.body_text, 150)
                : 'The agent is tracking this partner thread.'}
          </span>
          <span className="mt-4 flex flex-wrap gap-2">
            <StatusChip tone={hasReply ? 'forest' : 'muted'}>{statusLabel}</StatusChip>
            <StatusChip tone="muted">{thread.target_email ?? 'Contact hidden'}</StatusChip>
            {thread.needs_attention ? <StatusChip tone="clay">Needs attention</StatusChip> : null}
          </span>
        </span>
        <span className="flex items-start justify-between gap-3 sm:justify-end">
          <span className={`mt-1 h-2.5 w-2.5 rounded-full ${hasReply ? 'bg-forest' : thread.needs_attention ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
          <span className="font-semibold text-muted-foreground">{isExpanded ? 'Hide' : 'Drill in'} {isExpanded ? 'v' : '>'}</span>
        </span>
      </button>

      {isExpanded ? (
        <div className="grid gap-6 border-t border-border bg-background/40 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.4fr)]">
          <div className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Why the agent is watching this</p>
              <div className="mt-4 space-y-3 text-base leading-7 text-foreground">
                <ReasonLine>Thread is tied to this planner outreach flow.</ReasonLine>
                <ReasonLine>{hasReply ? 'A reply is ready to parse into terms and next steps.' : 'The agent is waiting for a partner response.'}</ReasonLine>
                <ReasonLine>Any follow-up, hold, booking, or payment still requires approval.</ReasonLine>
              </div>
            </div>

            <div className="rounded-md border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {hasReply ? 'Latest reply' : 'Draft sent'}
              </p>
              <p className="mt-4 text-lg font-semibold text-foreground">{latestMessage?.subject ?? 'Outreach thread'}</p>
              <p className="mt-3 whitespace-pre-wrap text-base leading-8 text-muted-foreground">
                {latestMessage?.body_text ?? 'No message body available yet.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onSync(thread.id)}
                  disabled={busyThreadId === thread.id}
                >
                  {busyThreadId === thread.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync replies
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onMarkHandled(thread.id)}
                  disabled={busyThreadId === thread.id}
                >
                  Mark handled
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Signals</p>
            <div className="mt-5 space-y-4">
              <SummaryLine label="Status" value={statusLabel} />
              <SummaryLine label="Last event" value={formatDate(thread.last_event_at)} />
              <SummaryLine label="Last outbound" value={formatDate(thread.last_outbound_at)} />
              <SummaryLine label="Last inbound" value={formatDate(thread.last_inbound_at)} />
              <SummaryLine label="Messages" value={String(thread.messages.length)} />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function ThreadCard({
  thread,
  busyThreadId,
  onSync,
  onMarkHandled,
}: {
  thread: GmailOutreachThread
  busyThreadId: string | null
  onSync: (threadId: string) => void
  onMarkHandled: (threadId: string) => void
}) {
  const latestMessage = thread.messages[thread.messages.length - 1]
  const hasReply = Boolean(thread.last_inbound_at) || thread.messages.some((message) => message.direction === 'inbound')

  return (
    <article className="rounded-md border border-border bg-background/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">{thread.target_name}</p>
          <p className="text-xs text-muted-foreground">{thread.target_email ?? 'Email hidden'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusChip tone={hasReply ? 'forest' : 'muted'}>{hasReply ? 'Replied' : 'Waiting'}</StatusChip>
            {thread.needs_attention ? <StatusChip tone="clay">Needs review</StatusChip> : null}
            <StatusChip tone="muted">{thread.target_type} · {thread.state.replace(/_/g, ' ')}</StatusChip>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onSync(thread.id)}
            disabled={busyThreadId === thread.id}
          >
            {busyThreadId === thread.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync replies
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onMarkHandled(thread.id)}
            disabled={busyThreadId === thread.id}
          >
            Mark handled
          </Button>
        </div>
      </div>
      {latestMessage ? (
        <div className="mt-4 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{latestMessage.direction}</span>
            <span className="text-xs text-muted-foreground">{formatDate(latestMessage.received_at ?? latestMessage.sent_at)}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-foreground">{latestMessage.subject}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {latestMessage.body_text}
          </p>
        </div>
      ) : null}
    </article>
  )
}

function AgentRecommendationCard({ thread, replyCount }: { thread: GmailOutreachThread; replyCount: number }) {
  const inboundMessages = thread.messages.filter((message) => message.direction === 'inbound')
  const latestReply = inboundMessages[inboundMessages.length - 1]

  return (
    <article className="overflow-hidden rounded-md border border-forest/30 bg-forest/10">
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-forest">Best next step based on replies</p>
        <h3 className="mt-4 font-display text-3xl font-semibold leading-tight text-foreground">
          Review {thread.target_name} as the next move.
        </h3>
        <p className="mt-3 text-base leading-8 text-muted-foreground">
          {replyCount > 1
            ? `The agent has ${replyCount} replies to compare. Start with this thread because it has the clearest next action.`
            : 'The agent has one reply to parse into terms, risk, and a follow-up approval.'}
        </p>
      </div>
      <div className="border-t border-forest/20 bg-card/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Reply signal</p>
        <p className="mt-3 text-base leading-8 text-foreground">
          {latestReply?.body_text ?? 'Reply detected. Sync or open the event record to review parsed terms.'}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <Link href="/planner/experiences">
              Open event record
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/planner/payments">Open approvals</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}

function ReasonLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-3">
      <Check className="mt-1 h-5 w-5 shrink-0 text-forest" />
      <span>{children}</span>
    </p>
  )
}

function SummaryLine({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-sm font-semibold text-foreground ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}

function StatusChip({ children, tone }: { children: ReactNode; tone: 'clay' | 'forest' | 'muted' }) {
  const classes = {
    clay: 'border-primary/30 bg-primary/10 text-primary',
    forest: 'border-forest/30 bg-forest/10 text-forest',
    muted: 'border-border bg-card text-muted-foreground',
  }

  return (
    <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${classes[tone]}`}>
      {children}
    </span>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-background/60 p-6 text-sm leading-relaxed text-muted-foreground">
      {text}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <Label className="mb-1.5 block text-sm font-semibold text-foreground">{label}</Label>
      {children}
    </label>
  )
}

function summarizeThreads(threads: GmailOutreachThread[]): ThreadStats {
  return threads.reduce<ThreadStats>((stats, thread) => {
    const hasReply = Boolean(thread.last_inbound_at) || thread.messages.some((message) => message.direction === 'inbound')
    return {
      sent: stats.sent + 1,
      waiting: stats.waiting + (hasReply ? 0 : 1),
      replied: stats.replied + (hasReply ? 1 : 0),
      needsAttention: stats.needsAttention + (thread.needs_attention ? 1 : 0),
    }
  }, { sent: 0, waiting: 0, replied: 0, needsAttention: 0 })
}

function buildProposalHeadline(approval: GmailApprovalState['approval'], threads: GmailOutreachThread[]) {
  if (approval) return 'The agent has an outreach batch ready for review.'
  if (threads.length > 0) return `The agent is tracking ${threads.length} partner thread${threads.length === 1 ? '' : 's'} for this event.`
  return 'The agent is ready to find partners for this event.'
}

function buildProposalDetail(approval: GmailApprovalState['approval'], stats: ThreadStats) {
  if (approval) return 'Review the batch before Gmail sends. The host stays in control of every outbound message.'
  if (stats.sent > 0) {
    return `${stats.replied} replied, ${stats.waiting} waiting, and ${stats.needsAttention} need review. Replies can update the event brief and next approvals.`
  }
  return 'Start with discovery so 3rdPlace can rank venues and vendors, prepare outreach, and create the approval batch.'
}

function formatTargetCountsFromThreads(threads: GmailOutreachThread[]) {
  const venueCount = threads.filter((thread) => normalizeTargetType(thread.target_type) === 'venue').length
  const vendorCount = threads.filter((thread) => normalizeTargetType(thread.target_type) === 'vendor').length
  const parts = [
    venueCount ? `${venueCount} venue${venueCount === 1 ? '' : 's'}` : null,
    vendorCount ? `${vendorCount} vendor${vendorCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : `${threads.length} partner${threads.length === 1 ? '' : 's'}`
}

function normalizeTargetType(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('vendor')) return 'vendor'
  return 'venue'
}

function formatDate(value: string | null) {
  if (!value) return 'Not synced yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trim()}...`
}

function titleize(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function defaultBodyText() {
  return [
    'Hi {{place_name}},',
    '',
    "I'm planning a Bay Area happy hour and wanted to see whether there is a fit to support the event.",
    '',
    'If you are interested, please reply with available dates, pricing or minimums, and the best next step.',
    '',
    'Thanks,',
    '{{sender_email}}',
  ].join('\n')
}
