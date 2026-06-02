'use client'

import { useState } from 'react'
import { ExternalLink, Loader2, MessageCircle, PhoneCall, Save, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { buildInstagramDmDeepLink } from '@/lib/outreach/channels'
import type { OutreachChannel } from '@/lib/types'

interface OutreachDraftComposerProps {
  planId: string
  threadId: string
  draftMessageId: string
  initialSubject: string
  initialBody: string
  canSend?: boolean
  channel?: OutreachChannel
  instagramHandle?: string | null
}

export function OutreachDraftComposer({
  planId,
  threadId,
  draftMessageId,
  initialSubject,
  initialBody,
  canSend = true,
  channel = 'email',
  instagramHandle = null,
}: OutreachDraftComposerProps) {
  const [subject, setSubject] = useState(initialSubject)
  const [body, setBody] = useState(initialBody)
  const [isSaving, setIsSaving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function persistDraft() {
    const response = await fetch(`/api/planner/plans/${planId}/outreach/${threadId}/drafts/${draftMessageId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, bodyText: body }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload?.error ?? 'Unable to save draft')
  }

  async function saveDraft() {
    setIsSaving(true)
    setError(null)
    setStatus(null)

    try {
      await persistDraft()
      setStatus('Draft saved')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save draft')
    } finally {
      setIsSaving(false)
    }
  }

  async function sendDraft(manualSent = false) {
    setIsSending(true)
    setError(null)
    setStatus(null)

    try {
      await persistDraft()
      const response = await fetch(`/api/planner/plans/${planId}/outreach/${threadId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftMessageId, manualSent }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to send outreach')
      setStatus(channel === 'instagram' ? 'Marked as sent manually' : channel === 'sms' ? 'SMS sent' : channel === 'voice' ? 'Voice call started' : 'Sent from your connected Gmail')
      window.location.reload()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send outreach')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {channel === 'email' ? (
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="min-h-11 rounded-2xl border-border bg-background/60"
          aria-label="Email subject"
        />
      ) : null}
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="min-h-[260px] rounded-2xl border-border bg-background/60 leading-6"
        aria-label="Email body"
      />
      {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}
      {status ? <p className="text-sm font-semibold text-primary">{status}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={saveDraft} disabled={isSaving || isSending}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save draft
        </Button>
        {channel === 'instagram' ? (
          <>
            <Button type="button" variant="outline" asChild disabled={!instagramHandle}>
              <a href={instagramHandle ? buildInstagramDmDeepLink({ handle: instagramHandle, message: body }) : '#'}>
                <ExternalLink className="h-4 w-4" />
                Open Instagram
              </a>
            </Button>
            <Button type="button" variant="default" onClick={() => sendDraft(true)} disabled={!canSend || isSaving || isSending}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
              I sent it
            </Button>
          </>
        ) : (
          <Button type="button" variant="default" onClick={() => sendDraft(false)} disabled={!canSend || isSaving || isSending}>
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : channel === 'voice' ? <PhoneCall className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {channel === 'sms' ? 'Send SMS' : channel === 'voice' ? 'Place call' : 'Send with Gmail'}
          </Button>
        )}
      </div>
    </div>
  )
}
