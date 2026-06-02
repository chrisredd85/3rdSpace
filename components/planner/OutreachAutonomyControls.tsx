'use client'

import { useState } from 'react'
import { Loader2, PauseCircle, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface OutreachAutonomyControlsProps {
  policyVersion: number
  trustLevel: number
  allowedActions: string[]
  unreadNotifications: number
}

export function OutreachAutonomyControls({
  policyVersion,
  trustLevel,
  allowedActions,
  unreadNotifications,
}: OutreachAutonomyControlsProps) {
  const [isPausing, setIsPausing] = useState(false)
  const [isUndoing, setIsUndoing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autonomyEnabled = allowedActions.length > 0

  async function pauseAgent() {
    setIsPausing(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch('/api/planner/outreach/pause', { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to pause agent')
      setStatus(`Paused. ${payload.cancelledMessages ?? 0} scheduled sends cancelled.`)
      window.location.reload()
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : 'Unable to pause agent')
    } finally {
      setIsPausing(false)
    }
  }

  async function undoLastAction() {
    setIsUndoing(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch('/api/planner/outreach/undo', { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to undo')
      setStatus(payload.undone ? `Undo complete: ${payload.outcome}` : 'No undoable autonomous action found.')
      if (payload.undone) window.location.reload()
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Unable to undo')
    } finally {
      setIsUndoing(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-cream p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">
              Autonomy {autonomyEnabled ? 'enabled' : 'off'} · trust {trustLevel}/100 · policy v{policyVersion}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {autonomyEnabled ? allowedActions.map((action) => action.replace(/_/g, ' ')).join(', ') : 'Every outreach action still requires approval.'}
            </p>
            {unreadNotifications > 0 ? (
              <p className="mt-1 text-xs font-semibold text-primary">{unreadNotifications} unread outreach notification{unreadNotifications === 1 ? '' : 's'}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={undoLastAction} disabled={isUndoing || isPausing}>
            {isUndoing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Undo last
          </Button>
          <Button type="button" variant="outline" onClick={pauseAgent} disabled={isPausing || isUndoing || !autonomyEnabled}>
            {isPausing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
            Pause agent
          </Button>
        </div>
      </div>
      {status ? <p className="mt-3 text-sm font-semibold text-primary">{status}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-destructive">{error}</p> : null}
    </div>
  )
}
