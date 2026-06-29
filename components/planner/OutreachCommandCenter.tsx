'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ClipboardCheck,
  Inbox,
  ListChecks,
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
  { kind: 'venue', name: 'Stable Cafe', email: '' },
  { kind: 'venue', name: 'Mission Social Hall', email: '' },
  { kind: 'vendor', name: 'Photo vendor', email: '' },
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
  const stats = useMemo(() => summarizeThreads(threads), [threads])
  const replyThreads = useMemo(
    () => threads.filter((thread) => Boolean(thread.last_inbound_at) || thread.messages.some((message) => message.direction === 'inbound')),
    [threads]
  )

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
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Partner sourcing</p>
            <h1 className="mt-2 font-display text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">Outreach command center</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Find partners, prepare outreach batches, review replies, and compare returned terms. 3rdPlace can prepare the loop, but every outbound message still routes through approvals.
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
          <div className="space-y-6">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
              <Card className="border-border bg-card shadow-sm">
                <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
                  <CommandMetric label="Plan context" value={state?.planId ? 'Selected event' : 'No event selected'} detail={state?.planId ? 'Outreach is tied to the current planner record.' : 'Choose a plan before discovery.'} />
                  <CommandMetric label="Approval batch" value={state?.approval ? titleize(state.approval.status) : 'None waiting'} detail="Messages send only after approval." />
                  <CommandMetric label="Sent threads" value={String(stats.sent)} detail={`${stats.waiting} waiting for response`} />
                  <CommandMetric label="Replies" value={String(stats.replied)} detail={`${stats.needsAttention} need attention`} />
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/10 shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Connected sender</p>
                  <p className="mt-2 break-all text-sm font-semibold text-foreground">{connectedEmail}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Gmail is connected for approved sends, reply sync, and thread handling.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <WorkflowStep icon={<Search className="h-5 w-5" />} title="Discover" detail="Search Places, catalog, and known contacts." />
              <WorkflowStep icon={<ClipboardCheck className="h-5 w-5" />} title="Approve" detail="Create reviewed batches before Gmail sends." />
              <WorkflowStep icon={<Inbox className="h-5 w-5" />} title="Track" detail="Sync sent threads and replies." />
              <WorkflowStep icon={<ListChecks className="h-5 w-5" />} title="Compare" detail="Use replies to update the brief and next approvals." />
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border">
                  <CardTitle className="text-xl">Find partners</CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Start from the event context. 3rdPlace ranks fit, scans websites, resolves contact status, then prepares the batch for approval.
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
                  <ActionTile
                    href={planSearchHref}
                    title="Find venues"
                    detail="Search Places and contact-ready venue leads."
                    icon={<Search className="h-5 w-5" />}
                  />
                  <ActionTile
                    href="/planner/vendors"
                    title="Review vendors"
                    detail="Check vendor fit, readiness, and returned quotes."
                    icon={<ListChecks className="h-5 w-5" />}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomComposer(true)}
                    className="rounded-md border border-border bg-background/70 p-4 text-left transition-colors hover:bg-background"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-primary">
                      <Plus className="h-5 w-5" />
                    </span>
                    <span className="mt-4 block font-display text-xl font-semibold text-foreground">Add a place I know</span>
                    <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">Use custom outreach only when discovery misses a known partner.</span>
                  </button>
                </CardContent>
              </Card>

              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border">
                  <CardTitle className="text-xl">Outreach approval batches</CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Batches are the review checkpoint. The host sees recipients and message terms in Approvals before Gmail sends.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {state?.approval ? (
                    <div className="rounded-md border border-forest/30 bg-forest/10 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-forest">Batch waiting</p>
                      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{titleize(state.approval.status)}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        There is an active outreach approval tied to this planner record.
                      </p>
                      <Button asChild className="mt-4">
                        <Link href={currentApprovalHref}>
                          Review in approvals
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border bg-background/60 p-5">
                      <p className="font-display text-2xl font-semibold text-foreground">No outreach batch waiting.</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        Find contact-ready partners, then create one reviewed batch. Individual recipients remain tracked under the approval.
                      </p>
                    </div>
                  )}
                  <Button asChild variant="outline">
                    <Link href={approvalsHref}>
                      Open approvals queue
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card className="border-border bg-card shadow-sm">
                <CardHeader className="border-b border-border">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Inbox className="h-5 w-5 text-primary" />
                    Sent threads
                  </CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Sync Gmail after approved sends. Threads stay visible here while the agent waits, reads, and marks handled replies.
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
                    Replies and quote comparison
                  </CardTitle>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Returned terms should feed the event brief, quote comparison, and next approval. Booking and payment remain separate approvals.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  {replyThreads.length ? (
                    replyThreads.map((thread) => (
                      <ReplySignalCard key={thread.id} thread={thread} />
                    ))
                  ) : (
                    <EmptyPanel text="No replies parsed yet. Replies appear here after Gmail sync reads the thread." />
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

function CommandMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-background/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold leading-tight text-foreground">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

function WorkflowStep({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background text-primary">
        {icon}
      </span>
      <p className="mt-4 font-display text-xl font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  )
}

function ActionTile({ href, icon, title, detail }: { href: string; icon: ReactNode; title: string; detail: string }) {
  return (
    <Link href={href} className="rounded-md border border-border bg-background/70 p-4 transition-colors hover:bg-background">
      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-primary">
        {icon}
      </span>
      <span className="mt-4 block font-display text-xl font-semibold text-foreground">{title}</span>
      <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{detail}</span>
    </Link>
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

function ReplySignalCard({ thread }: { thread: GmailOutreachThread }) {
  const inboundMessages = thread.messages.filter((message) => message.direction === 'inbound')
  const latestReply = inboundMessages[inboundMessages.length - 1]

  return (
    <article className="rounded-md border border-border bg-background/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">{thread.target_name}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {latestReply?.body_text ? latestReply.body_text : 'Reply detected. Sync or open the event record to review parsed terms.'}
          </p>
        </div>
        <StatusChip tone={thread.needs_attention ? 'clay' : 'forest'}>{thread.needs_attention ? 'Needs review' : 'Parsed reply'}</StatusChip>
      </div>
    </article>
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
