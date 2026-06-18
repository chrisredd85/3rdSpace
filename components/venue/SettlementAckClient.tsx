'use client'

import { useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2, CreditCard, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

type SettlementAckClientProps = {
  token: string
  initialStatus: string
}

export function SettlementAckClient({ token, initialStatus }: SettlementAckClientProps) {
  const [status, setStatus] = useState(initialStatus)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<'pay' | 'dispute' | null>(null)

  async function pay() {
    setError(null)
    setLoading('pay')
    try {
      const response = await fetch(`/api/venue/settlement/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error ?? 'Unable to start checkout.')
        return
      }
      if (payload.already_paid) {
        setStatus('settled')
        return
      }
      if (typeof payload.hosted_checkout_url === 'string') {
        window.location.href = payload.hosted_checkout_url
      }
    } catch {
      setError('Unable to start checkout. Try again.')
    } finally {
      setLoading(null)
    }
  }

  async function dispute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setLoading('dispute')
    try {
      const response = await fetch(`/api/venue/settlement/${encodeURIComponent(token)}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: note }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error ?? 'Unable to submit dispute.')
        return
      }
      setStatus('disputed')
    } catch {
      setError('Unable to submit dispute. Try again.')
    } finally {
      setLoading(null)
    }
  }

  if (status === 'settled') {
    return (
      <div className="rounded-xl border border-forest/20 bg-forest/10 p-4 text-sm text-forest">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4" />
          Settlement paid
        </div>
        <p className="mt-2 text-forest/80">Stripe is routing the funds to the host&apos;s connected account.</p>
      </div>
    )
  }

  if (status === 'disputed') {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" />
          Dispute submitted
        </div>
        <p className="mt-2 text-primary/80">3rdPlace admin will review this with the host before payment can continue.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Button
        type="button"
        className="w-full"
        onClick={pay}
        disabled={Boolean(loading)}
      >
        {loading === 'pay' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
        Pay with Stripe Checkout
      </Button>

      <form onSubmit={dispute} className="rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-semibold text-foreground" htmlFor="settlement-dispute">
          Need to dispute this amount?
        </label>
        <textarea
          id="settlement-dispute"
          className="mt-2 min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          placeholder="Tell the host what needs review before this settlement can be paid."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          className="mt-3 w-full"
          disabled={Boolean(loading)}
        >
          {loading === 'dispute' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
          Submit dispute
        </Button>
      </form>
    </div>
  )
}
