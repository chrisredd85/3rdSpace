'use client'

import { useState } from 'react'
import { Loader2, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface OutreachManualReplyFormProps {
  planId: string
  threadId: string
}

export function OutreachManualReplyForm({ planId, threadId }: OutreachManualReplyFormProps) {
  const [bodyText, setBodyText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submitReply() {
    setIsSubmitting(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${planId}/outreach/${threadId}/manual-replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bodyText }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to log reply')
      setStatus('Reply logged')
      setBodyText('')
      window.location.reload()
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Unable to log reply')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={bodyText}
        onChange={(event) => setBodyText(event.target.value)}
        placeholder="Paste the venue's reply..."
        className="min-h-28 rounded-2xl border-border bg-background/60 leading-6"
        aria-label="Manual outreach reply"
      />
      {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}
      {status ? <p className="text-sm font-semibold text-primary">{status}</p> : null}
      <Button type="button" variant="outline" onClick={submitReply} disabled={isSubmitting || bodyText.trim().length === 0}>
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquarePlus className="h-4 w-4" />}
        Log reply
      </Button>
    </div>
  )
}
