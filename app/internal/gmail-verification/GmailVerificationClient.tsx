'use client'

import { useState, useTransition, type FormEvent } from 'react'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Inbox,
  Loader2,
  RefreshCw,
  Send,
  Unplug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  listGmailVerificationThreads,
  modifyGmailVerificationThread,
  sendGmailVerificationMessage,
} from './actions'
import type {
  GmailVerificationActionResult,
  GmailVerificationThread,
} from './types'

type GmailVerificationClientProps = {
  accountEmail: string
  initialThreads: GmailVerificationThread[]
  initialLoadError?: string | null
}

export function GmailVerificationClient({
  accountEmail,
  initialThreads,
  initialLoadError = null,
}: GmailVerificationClientProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({})
  const [sendResult, setSendResult] = useState<GmailVerificationActionResult | null>(null)
  const [threadResult, setThreadResult] = useState<GmailVerificationActionResult | null>(
    initialLoadError ? { ok: false, message: initialLoadError } : null
  )
  const [isSending, startSendTransition] = useTransition()
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [isThreadActionPending, startThreadTransition] = useTransition()
  const [isDisconnecting, startDisconnectTransition] = useTransition()

  function refreshThreads() {
    startRefreshTransition(() => {
      void (async () => {
        const result = await listGmailVerificationThreads()
        if (result.ok) {
          setThreads(result.threads)
          setThreadResult({ ok: true, message: 'Recent Gmail threads refreshed.' })
        } else {
          setThreadResult({ ok: false, message: result.message ?? 'Unable to refresh Gmail threads.' })
        }
      })()
    })
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    startSendTransition(() => {
      void (async () => {
        const result = await sendGmailVerificationMessage(sendResult, formData)
        setSendResult(result)
        if (result.ok) {
          form.reset()
          const threadsResult = await listGmailVerificationThreads()
          if (threadsResult.ok) setThreads(threadsResult.threads)
        }
      })()
    })
  }

  function updateThread(gmailThreadId: string, action: 'read' | 'unread' | 'archive') {
    const formData = new FormData()
    formData.set('gmailThreadId', gmailThreadId)
    formData.set('action', action)

    startThreadTransition(() => {
      void (async () => {
        const result = await modifyGmailVerificationThread(threadResult, formData)
        setThreadResult(result)
        if (result.ok) {
          const threadsResult = await listGmailVerificationThreads()
          if (threadsResult.ok) setThreads(threadsResult.threads)
        }
      })()
    })
  }

  function disconnectGmail() {
    startDisconnectTransition(() => {
      void (async () => {
        try {
          const response = await fetch('/api/integrations/gmail/account', { method: 'DELETE' })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload?.error ?? 'Unable to disconnect Gmail.')
          window.location.reload()
        } catch (error) {
          setThreadResult({
            ok: false,
            message: error instanceof Error ? error.message : 'Unable to disconnect Gmail.',
          })
        }
      })()
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-tan bg-cream p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Connected account
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-ink">{accountEmail}</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-soft">
              This page demonstrates Gmail send, read, and modify scopes for Google verification reviewers.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={disconnectGmail} disabled={isDisconnecting}>
            {isDisconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
            Disconnect Gmail
          </Button>
        </div>
      </section>

      <section className="rounded-md border border-tan bg-cream p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Compose</p>
            <h2 className="font-display text-2xl font-semibold text-ink">Send a Gmail verification message</h2>
          </div>
        </div>

        <form className="grid gap-4" onSubmit={sendMessage}>
          <label className="grid gap-2 text-sm font-semibold text-ink">
            To
            <input
              name="to"
              type="email"
              required
              className="rounded-md border border-tan bg-background px-3 py-2 font-sans text-sm font-normal text-ink outline-none focus:border-primary"
              placeholder="reviewer@example.com"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Subject
            <input
              name="subject"
              required
              className="rounded-md border border-tan bg-background px-3 py-2 font-sans text-sm font-normal text-ink outline-none focus:border-primary"
              placeholder="3rdPlace Gmail scope verification"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-ink">
            Body
            <textarea
              name="body"
              required
              rows={5}
              className="rounded-md border border-tan bg-background px-3 py-2 font-sans text-sm font-normal text-ink outline-none focus:border-primary"
              placeholder="This message demonstrates a user-approved Gmail send from 3rdPlace."
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={isSending}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send through Gmail
            </Button>
            {sendResult ? <ActionResult result={sendResult} /> : null}
          </div>
        </form>
      </section>

      <section className="rounded-md border border-tan bg-cream p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
              <Inbox className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Inbox</p>
              <h2 className="font-display text-2xl font-semibold text-ink">Recent Gmail threads</h2>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={refreshThreads} disabled={isRefreshing}>
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {threadResult ? <div className="mb-4"><ActionResult result={threadResult} /></div> : null}

        {threads.length === 0 ? (
          <div className="rounded-md border border-dashed border-tan bg-background p-6 text-sm text-ink-soft">
            No Gmail threads were returned for this connected account.
          </div>
        ) : (
          <div className="divide-y divide-tan overflow-hidden rounded-md border border-tan">
            {threads.map((thread) => {
              const isExpanded = Boolean(expandedThreads[thread.gmailThreadId])

              return (
                <article key={thread.gmailThreadId} className="bg-background">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-cream-deep/60"
                    onClick={() => {
                      setExpandedThreads((current) => ({
                        ...current,
                        [thread.gmailThreadId]: !isExpanded,
                      }))
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />
                    ) : (
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                        <h3 className="truncate font-display text-lg font-semibold text-ink">{thread.subject}</h3>
                        <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                          {formatThreadTime(thread.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-ink-soft">{thread.sender}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{thread.snippet}</p>
                    </div>
                  </button>

                  <div className="flex flex-wrap gap-2 border-t border-tan bg-cream-deep/45 px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateThread(thread.gmailThreadId, 'read')}
                      disabled={isThreadActionPending}
                    >
                      <Eye className="h-4 w-4" />
                      Mark as read
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateThread(thread.gmailThreadId, 'unread')}
                      disabled={isThreadActionPending}
                    >
                      <EyeOff className="h-4 w-4" />
                      Mark unread
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => updateThread(thread.gmailThreadId, 'archive')}
                      disabled={isThreadActionPending}
                    >
                      <Archive className="h-4 w-4" />
                      Archive
                    </Button>
                  </div>

                  {isExpanded ? (
                    <div className="space-y-3 border-t border-tan bg-cream px-4 py-4">
                      {thread.messages.length === 0 ? (
                        <p className="text-sm text-ink-soft">No message bodies were returned for this thread.</p>
                      ) : (
                        thread.messages.map((message) => (
                          <div key={message.gmailMessageId} className="rounded-md border border-tan bg-background p-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                              <p className="text-sm font-semibold text-ink">{message.from ?? 'Unknown sender'}</p>
                              <p className="text-xs text-ink-faint">{formatThreadTime(message.receivedAt)}</p>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-ink-soft">{message.subject}</p>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                              {message.bodyText || '(empty body)'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function ActionResult({ result }: { result: GmailVerificationActionResult }) {
  return (
    <p
      className={cn(
        'rounded-md border px-3 py-2 text-sm font-semibold',
        result.ok
          ? 'border-forest/20 bg-forest/10 text-forest'
          : 'border-destructive/20 bg-destructive/10 text-destructive'
      )}
    >
      {result.message}
      {result.gmailMessageId ? ` Message ID: ${result.gmailMessageId}.` : ''}
      {result.gmailThreadId ? ` Thread ID: ${result.gmailThreadId}.` : ''}
    </p>
  )
}

function formatThreadTime(value: string | null) {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No timestamp'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
