'use client'

import { useEffect, useState } from 'react'
import { Loader2, MailCheck, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Plan } from '@/lib/types'

interface OutreachSenderSettingsPanelProps {
  plan: Plan
  onPlanUpdated: (plan: Plan) => void
}

export function OutreachSenderSettingsPanel({ plan, onPlanUpdated }: OutreachSenderSettingsPanelProps) {
  const metadata = readRecord(plan.metadata)
  const [senderIdentity, setSenderIdentity] = useState(readString(metadata?.sender_identity) ?? '')
  const [creatorDisplayName, setCreatorDisplayName] = useState(readString(metadata?.creator_display_name) ?? '')
  const [budgetSignalInSubject, setBudgetSignalInSubject] = useState(metadata?.budget_signal_in_subject === true)
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const nextMetadata = readRecord(plan.metadata)
    setSenderIdentity(readString(nextMetadata?.sender_identity) ?? '')
    setCreatorDisplayName(readString(nextMetadata?.creator_display_name) ?? '')
    setBudgetSignalInSubject(nextMetadata?.budget_signal_in_subject === true)
    setStatus(null)
    setError(null)
  }, [plan.id, plan.metadata])

  async function saveSettings() {
    setIsSaving(true)
    setStatus(null)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          outreach_sender_identity: senderIdentity.trim() || null,
          outreach_creator_display_name: creatorDisplayName.trim() || null,
          outreach_budget_signal_in_subject: budgetSignalInSubject,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to save outreach sender settings')
      if (payload?.plan) onPlanUpdated(payload.plan as Plan)
      setStatus('Outreach sender saved')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save outreach sender settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-cream p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <MailCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-lg font-bold text-foreground">How outreach is sent</p>
            <p className="mt-1 text-sm text-muted-foreground">Sender details for venue and vendor drafts.</p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={saveSettings} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="outreach-sender-identity">Sender identity</Label>
          <Input
            id="outreach-sender-identity"
            value={senderIdentity}
            onChange={(event) => setSenderIdentity(event.target.value)}
            placeholder="Over the Top"
            className="min-h-11 rounded-2xl border-border bg-background/60"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="outreach-display-name">Display name</Label>
          <Input
            id="outreach-display-name"
            value={creatorDisplayName}
            onChange={(event) => setCreatorDisplayName(event.target.value)}
            placeholder="Sarah"
            className="min-h-11 rounded-2xl border-border bg-background/60"
            maxLength={120}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-border bg-background/45 px-4 py-3">
        <div>
          <Label htmlFor="outreach-budget-subject">Budget in subject</Label>
          <p className="mt-1 text-xs text-muted-foreground">Uses the plan budget only when enabled.</p>
        </div>
        <Switch
          id="outreach-budget-subject"
          checked={budgetSignalInSubject}
          onCheckedChange={setBudgetSignalInSubject}
          disabled={isSaving}
        />
      </div>

      {status ? <p className="mt-3 text-sm font-semibold text-primary">{status}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-destructive">{error}</p> : null}
    </div>
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
