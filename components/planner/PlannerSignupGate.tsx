'use client'

import Link from 'next/link'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PlannerCreatePlanResponse } from '@/lib/types'

interface PlannerSignupGateProps {
  isOpen: boolean
  onClose: () => void
  onSignedIn: (plan: PlannerCreatePlanResponse | null) => void
  context?: 'default' | 'recommendations'
}

/**
 * Signup handoff shown only when an anonymous planner user takes a conversion action.
 * The full creator signup owns account creation and planner draft migration.
 */
export function PlannerSignupGate({ isOpen, onClose, context = 'default' }: PlannerSignupGateProps) {
  if (!isOpen) return null

  const copy = context === 'recommendations'
    ? {
      title: 'Save your plan to see matches',
      description:
        'Finish the creator signup so I can save this draft, pull real venues and vendors, and attach financials and approval cards.',
      submitLabel: 'Continue to creator signup',
    }
    : {
      title: 'Save your plan to continue',
      description: 'Finish the creator signup so this draft can move into your workspace.',
      submitLabel: 'Continue to creator signup',
    }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/20 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-tan bg-cream shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-tan px-5 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-brand shadow-glow">
                <Sparkles className="h-5 w-5 text-cream" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold leading-tight text-ink">{copy.title}</h2>
                <p className="mt-1 text-sm leading-snug text-ink-soft">
                  {copy.description}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close signup"
            className="rounded-md p-2 text-ink-soft transition-colors hover:bg-cream-deep hover:text-ink"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-md border border-tan bg-cream-deep/55 px-4 py-3">
            <p className="text-sm leading-relaxed text-ink-soft">
              Your chat draft stays in this browser. After creator signup, I’ll save it to your workspace and return you to the planner.
            </p>
          </div>

          <Button asChild className="h-12 w-full rounded-md">
            <Link href="/signup/builder">{copy.submitLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
