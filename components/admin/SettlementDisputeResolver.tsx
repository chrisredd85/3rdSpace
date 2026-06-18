'use client'

import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function SettlementDisputeResolver({ runId }: { runId: string }) {
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setStatus(null)
    try {
      const response = await fetch(`/api/admin/settlements/${encodeURIComponent(runId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(payload.error ?? 'Unable to resolve dispute.')
        return
      }
      setStatus(`Resolved to ${payload.status ?? 'review'}. Refresh to see updated queue.`)
    } catch {
      setStatus('Unable to resolve dispute.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={resolve} className="mt-4 rounded-xl border border-border bg-background p-3">
      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground" htmlFor={`resolve-${runId}`}>
        Resolution note
      </label>
      <textarea
        id={`resolve-${runId}`}
        className="mt-2 min-h-20 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button type="submit" size="sm" className="mt-3" disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Resolve to organizer review
      </Button>
      {status ? <p className="mt-2 text-sm text-muted-foreground">{status}</p> : null}
    </form>
  )
}
