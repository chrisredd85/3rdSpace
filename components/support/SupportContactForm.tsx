'use client'

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SupportCategory, SupportSeverity, SupportPlanSummary } from '@/lib/support/tickets'

const categories: Array<{ value: SupportCategory; label: string }> = [
  { value: 'bug', label: 'Bug' },
  { value: 'question', label: 'Question' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'Account' },
  { value: 'feature_request', label: 'Feature request' },
  { value: 'other', label: 'Other' },
]

const severities: Array<{ value: SupportSeverity; label: string; help: string }> = [
  { value: 'low', label: 'Low', help: 'Minor issue or general feedback.' },
  { value: 'medium', label: 'Medium', help: 'Blocking a workflow, but there is a workaround.' },
  { value: 'high', label: 'High', help: 'Blocking active event planning or a time-sensitive partner step.' },
  { value: 'urgent', label: 'Urgent', help: 'Live event, payment, account access, or safety issue.' },
]

type SupportContactFormProps = {
  mode: 'public' | 'planner'
  userEmail?: string | null
  userName?: string | null
  plans?: SupportPlanSummary[]
}

export function SupportContactForm({
  mode,
  userEmail,
  userName,
  plans = [],
}: SupportContactFormProps) {
  const [category, setCategory] = useState<SupportCategory>('question')
  const [severity, setSeverity] = useState<SupportSeverity>('medium')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState(userEmail ?? '')
  const [name, setName] = useState(userName ?? '')
  const [relatedPlanId, setRelatedPlanId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)

  const selectedSeverity = useMemo(
    () => severities.find((item) => item.value === severity) ?? severities[1],
    [severity]
  )
  const canSubmit =
    subject.trim().length >= 3 &&
    description.trim().length >= 10 &&
    (mode === 'planner' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

  async function submitSupportTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)
    setError(null)
    setTicketId(null)

    try {
      const response = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          category,
          severity,
          subject,
          description,
          related_plan_id: relatedPlanId || null,
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          current_url: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({} as { error?: string; ticket_id?: string }))
      if (!response.ok) throw new Error(payload.error ?? 'Could not submit support request.')

      setTicketId(payload.ticket_id ?? null)
      setSubject('')
      setDescription('')
      setRelatedPlanId('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not submit support request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (ticketId) {
    return (
      <div className="rounded-lg border border-forest/30 bg-forest-tint p-6 text-forest">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Support request received</p>
            <p className="mt-2 text-sm leading-relaxed">
              Your ticket reference is <span className="font-mono font-semibold">{ticketId}</span>. We typically respond within 24 hours; urgent issues are reviewed as quickly as possible.
            </p>
            {mode === 'planner' ? (
              <Button asChild className="mt-4" variant="outline">
                <Link href="/planner/support/tickets">View your tickets</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submitSupportTicket} className="space-y-5 rounded-lg border border-tan bg-cream p-5 shadow-sm">
      {mode === 'public' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
          </Field>
          <Field label="Email" required>
            <Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </Field>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <Select value={category} onChange={(value) => setCategory(value as SupportCategory)}>
            {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>
        <Field label="Severity" required helper={selectedSeverity.help}>
          <Select value={severity} onChange={(value) => setSeverity(value as SupportSeverity)}>
            {severities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Subject" required>
        <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Short summary" maxLength={160} />
      </Field>

      {mode === 'planner' && plans.length > 0 ? (
        <Field label="Related plan">
          <Select value={relatedPlanId} onChange={setRelatedPlanId}>
            <option value="">No specific plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.title}</option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Description" required helper="Include what you expected, what happened, and any time-sensitive context.">
        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Describe the issue..."
          rows={7}
          maxLength={8000}
        />
      </Field>

      {error ? (
        <div className="rounded-md border border-brick/40 bg-brick-tint px-4 py-3 text-sm text-brick">{error}</div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-tan pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-soft">
          Or email <a href="mailto:support@3rdplace.io" className="font-semibold text-clay hover:text-clay-deep">support@3rdplace.io</a> directly.
        </p>
        <Button type="submit" disabled={!canSubmit || isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit request
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  required = false,
  helper,
  children,
}: {
  label: string
  required?: boolean
  helper?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-ink">
        {label}{required ? <span className="text-clay"> *</span> : null}
      </Label>
      {children}
      {helper ? <p className="text-xs leading-relaxed text-ink-soft">{helper}</p> : null}
    </div>
  )
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
    </select>
  )
}
