import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock3, Mail, Send } from 'lucide-react'
import { OutreachDraftComposer } from '@/components/planner/OutreachDraftComposer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import type { Json, OutreachMessage, OutreachThread, Plan } from '@/lib/types'

const THREAD_SELECT = `
  id,
  plan_id,
  user_id,
  target_type,
  target_id,
  target_name,
  target_email,
  channel,
  state,
  source_agent_action_id,
  needs_attention,
  follow_up_count,
  last_event_at,
  last_outbound_at,
  last_inbound_at,
  next_action_at,
  created_at,
  updated_at
`

const MESSAGE_SELECT = `
  id,
  thread_id,
  agent_action_id,
  approval_id,
  direction,
  gmail_message_id,
  gmail_thread_id,
  subject,
  body_text,
  body_html,
  headers_json,
  sent_at,
  received_at,
  classification_json,
  created_at
`

interface PageProps {
  params: {
    threadId: string
  }
}

export default async function OutreachThreadPage({ params }: PageProps) {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) notFound()

  const { data: threadData } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('id', params.threadId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!threadData) notFound()
  const thread = threadData as OutreachThread

  const [{ data: planData }, { data: messageRows }] = await Promise.all([
    db.from('plans').select('id, title, date_window_start, date_window_end, guest_count, budget_cap_cents').eq('id', thread.plan_id).maybeSingle(),
    db.from('outreach_messages').select(MESSAGE_SELECT).eq('thread_id', thread.id).order('created_at', { ascending: true }),
  ])

  const plan = planData as Plan | null
  const messages = (messageRows ?? []) as OutreachMessage[]
  const editableDraft = [...messages].reverse().find((message) => message.direction === 'outbound' && !message.sent_at)
  const approvalStatus = editableDraft?.agent_action_id
    ? await loadApprovalStatus(db, editableDraft.agent_action_id, thread.plan_id)
    : null

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Button asChild variant="glass" size="sm" className="mb-4">
              <Link href="/planner/outreach">
                <ArrowLeft className="h-4 w-4" />
                Outreach
              </Link>
            </Button>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              {thread.target_type}
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">{thread.target_name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{thread.target_email}</p>
          </div>
          <StateBadge state={thread.state} needsAttention={thread.needs_attention} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>

          <aside className="space-y-4">
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle className="text-xl">Thread</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <InfoRow label="Plan" value={plan?.title ?? 'Untitled plan'} />
                <InfoRow label="Event date" value={formatPlanDate(plan)} />
                <InfoRow label="Headcount" value={plan?.guest_count ? String(plan.guest_count) : 'TBD'} />
                <InfoRow label="Follow-ups" value={String(thread.follow_up_count)} />
                <InfoRow label="Next action" value={formatOptionalDateTime(thread.next_action_at)} />
              </CardContent>
            </Card>

            {editableDraft ? (
              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <Send className="h-5 w-5 text-primary" />
                    Draft
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!approvalStatus ? (
                    <div className="rounded-2xl border border-secondary/40 bg-secondary/10 p-3 text-sm font-semibold text-secondary">
                      Approval is required before Gmail send.
                    </div>
                  ) : approvalStatus && !['approved', 'authorized'].includes(approvalStatus) ? (
                    <div className="space-y-3 rounded-2xl border border-secondary/40 bg-secondary/10 p-3 text-sm font-semibold text-secondary">
                      <p>Approval status: {approvalStatus.replace(/_/g, ' ')}</p>
                      <Button asChild variant="glass" size="sm">
                        <Link href="/planner/payments">Open approvals</Link>
                      </Button>
                    </div>
                  ) : null}
                  <OutreachDraftComposer
                    planId={thread.plan_id}
                    threadId={thread.id}
                    draftMessageId={editableDraft.id}
                    initialSubject={editableDraft.subject}
                    initialBody={editableDraft.body_text}
                    canSend={approvalStatus === 'approved' || approvalStatus === 'authorized'}
                  />
                </CardContent>
              </Card>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}

function MessageCard({ message }: { message: OutreachMessage }) {
  const classification = readRecord(message.classification_json)
  const summary = typeof classification?.summary_for_creator === 'string' ? classification.summary_for_creator : null
  const intent = typeof classification?.intent === 'string' ? classification.intent : null

  return (
    <Card className={cn('rounded-3xl', message.direction === 'inbound' && 'border-primary/30')}>
      <CardHeader className="border-b border-border">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg">{message.subject}</CardTitle>
            <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {message.direction}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-sidebar-accent px-3 py-1 text-xs font-bold text-muted-foreground">
            {message.sent_at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            {formatOptionalDateTime(message.sent_at ?? message.received_at ?? message.created_at)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground/90">
          {message.body_text}
        </pre>
        {summary ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">{intent ?? 'classifier'}</p>
            <p className="mt-2 text-sm text-foreground">{summary}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function StateBadge({ state, needsAttention }: { state: string; needsAttention: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold capitalize',
        needsAttention
          ? 'border-secondary/50 bg-secondary/15 text-secondary'
          : 'border-primary/35 bg-primary/10 text-primary'
      )}
    >
      <Mail className="h-4 w-4" />
      {needsAttention ? 'Needs review' : state.replace(/_/g, ' ')}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold text-foreground">{value}</span>
    </div>
  )
}

async function loadApprovalStatus(db: any, actionId: string, planId: string) {
  const { data } = await db
    .from('approvals')
    .select('status')
    .eq('agent_action_id', actionId)
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return typeof data?.status === 'string' ? data.status : null
}

function formatPlanDate(plan: Plan | null) {
  const value = plan?.date_window_start ?? plan?.date_window_end
  if (!value) return 'TBD'
  return formatOptionalDateTime(value)
}

function formatOptionalDateTime(value: string | null) {
  if (!value) return 'None'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'None'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: value.includes('T') ? 'numeric' : undefined,
    minute: value.includes('T') ? '2-digit' : undefined,
  }).format(date)
}

function readRecord(value: Json | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
