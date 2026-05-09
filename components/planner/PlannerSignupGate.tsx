'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineFormError } from '@/components/ui/inline-form-error'
import { migratePlannerDraftToServer } from '@/lib/planner/migrateDraft'
import type { PlannerCreatePlanResponse } from '@/lib/types'

interface PlannerSignupGateProps {
  isOpen: boolean
  onClose: () => void
  onSignedIn: (plan: PlannerCreatePlanResponse | null) => void
}

/**
 * Inline signup modal shown only when an anonymous planner user takes a conversion action.
 */
export function PlannerSignupGate({ isOpen, onClose, onSignedIn }: PlannerSignupGateProps) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (errorMessage) setErrorMessage(null)
  }, [fullName, email, password])

  if (!isOpen) return null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userType: 'community_builder',
          name: fullName,
          email,
          password,
          organization_name: `${fullName || 'Event creator'} events`,
          event_types: ['Community gatherings'],
          ticket_platforms: ['partiful'],
        }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Could not create your account.')
      }

      if (payload.requiresEmailConfirmation) {
        throw new Error('Check your email to confirm your account, then return to continue.')
      }

      const migratedPlan = await migratePlannerDraftToServer()
      onSignedIn(migratedPlan)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not create your account.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold leading-tight text-foreground">Save your plan to continue</h2>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  Create your event creator account and the agent will continue the action.
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close signup"
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          <label className="block text-sm font-semibold text-foreground">
            Full name
            <Input
              className="mt-2"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              placeholder="Alex Rivera"
              required
              disabled={isSubmitting}
            />
          </label>

          <label className="block text-sm font-semibold text-foreground">
            Email
            <Input
              className="mt-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="alex@example.com"
              required
              disabled={isSubmitting}
            />
          </label>

          <label className="block text-sm font-semibold text-foreground">
            Password
            <Input
              className="mt-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              required
              minLength={6}
              disabled={isSubmitting}
            />
          </label>

          <InlineFormError message={errorMessage} />

          <Button type="submit" className="h-12 w-full rounded-2xl" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create account & continue
          </Button>
        </form>
      </div>
    </div>
  )
}
