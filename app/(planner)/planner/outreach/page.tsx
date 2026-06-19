'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
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

const initialTargets: TargetDraft[] = [
  { kind: 'venue', name: 'Stable Cafe', email: '' },
  { kind: 'venue', name: 'Mission Social Hall', email: '' },
  { kind: 'vendor', name: 'Photo vendor', email: '' },
]

export default function PlannerOutreachPage() {
  const [state, setState] = useState<GmailApprovalState | null>(null)
  const [targets, setTargets] = useState<TargetDraft[]>(initialTargets)
  const [subject, setSubject] = useState('Happy hour partnership inquiry')
  const [bodyText, setBodyText] = useState(defaultBodyText())
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null)
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
      window.location.href = payload.redirect_url ?? '/planner?tab=approvals'
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
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Planner approvals</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-foreground">Gmail outreach</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              3rdPlace creates the outreach proposal here. The email only sends after you approve it in the planner.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={state?.planId ? `/planner/outreach-search?plan=${state.planId}` : '/planner/outreach-search'}>
                <Search className="h-4 w-4" />
                Find venues
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
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="border-b border-border">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-xl">Build a partner outreach batch</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Connected as <span className="font-semibold text-foreground">{connectedEmail}</span>
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    Gmail connected
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-6">
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
                  Replies appear below after syncing from Gmail, so the agent can compare the options before recommending next steps.
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="button" onClick={createApproval} disabled={!canCreateApproval || isCreating}>
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Create planner approval
                  </Button>
                  {state?.approval && state.planId && state.approvalMessageId ? (
                    <Button asChild variant="outline">
                      <Link href={`/planner?plan=${state.planId}&tab=approvals&msg=${state.approvalMessageId}`}>
                        Open current approval
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="border-b border-border">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Inbox className="h-5 w-5 text-primary" />
                  Sent threads and replies
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                {state?.threads.length ? (
                  state.threads.map((thread) => (
                    <div key={thread.id} className="rounded-md border border-border bg-background/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{thread.target_name}</p>
                          <p className="text-xs text-muted-foreground">{thread.target_email}</p>
                          <span className="mt-2 inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                            {thread.target_type} · {thread.state.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => syncThread(thread.id)}
                            disabled={busyThreadId === thread.id}
                          >
                            {busyThreadId === thread.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            Sync replies
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => markHandled(thread.id)}
                            disabled={busyThreadId === thread.id}
                          >
                            Mark handled
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 space-y-3">
                        {thread.messages.map((message) => (
                          <article key={message.id} className="rounded-md border border-border bg-card p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                                {message.direction}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(message.received_at ?? message.sent_at)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-foreground">{message.subject}</p>
                            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                              {message.body_text}
                            </p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-background/60 p-6 text-sm leading-relaxed text-muted-foreground">
                    No sent Gmail outreach yet. Create an approval, approve it in the planner, then return here to sync replies.
                  </div>
                )}
              </CardContent>
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

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <Label className="mb-1.5 block text-sm font-semibold text-foreground">{label}</Label>
      {children}
    </label>
  )
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
