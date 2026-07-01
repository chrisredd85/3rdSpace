/**
 * Purpose: Provides the public homepage event creation composer.
 * Props: Accepts optional className for placement inside the homepage hero.
 * Key behaviors: Lets creators describe an event before creating an account,
 * then forwards the draft prompt into `/planner` so the Agent Planner can begin.
 */
'use client'

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { storePendingEventDraft } from '@/lib/planner/pendingEventDraft'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface HomePlannerStartProps {
  className?: string
}

const samplePrompts = [
  {
    label: 'Founder dinner, 36, Mission, $5k budget',
    prompt: 'Founder dinner for 36 in the Mission with a $5,000 budget',
  },
  {
    label: 'Ticketed mixer, 80, SoMa, find 3 venues',
    prompt: 'Ticketed mixer for 80 in SoMa - find and compare three venue options',
  },
  {
    label: 'Repeat a past event, new date',
    prompt: 'Repeat a past event with a new date and updated guest count',
    intent: 'rebook',
  },
] as const

async function hasActiveSession(timeoutMs = 1500) {
  try {
    const supabase = createClient()
    return await Promise.race([
      supabase.auth.getSession().then(({ data }) => Boolean(data.session)).catch(() => false),
      new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } catch {
    return false
  }
}

/**
 * Public event creation composer for the homepage.
 */
export function HomePlannerStart({ className }: HomePlannerStartProps) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  /**
   * Sends the draft prompt to the planner route, or preserves it for signup.
   */
  async function startPlanner(value = draftRef.current?.value ?? draft) {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    const rebookIntent = /\b(rebook|repeat|reuse)\b.*\b(past|previous|last|saved|template|event)\b/i.test(trimmed)
    const params = new URLSearchParams({ draft: trimmed })
    if (rebookIntent) params.set('intent', 'rebook')

    try {
      const signupParams = new URLSearchParams({ returnTo: rebookIntent ? '/planner/new-plan' : '/planner', draft: 'pending' })

      if (!(await hasActiveSession())) {
        storePendingEventDraft({
          prompt: trimmed,
          timestamp: Date.now(),
          intent: rebookIntent ? 'rebook' : undefined,
        })
        router.push(`/signup/builder?${signupParams.toString()}`)
        return
      }

      router.push(rebookIntent ? `/planner/new-plan?${params.toString()}` : `/planner?${params.toString()}`)
    } catch {
      const signupParams = new URLSearchParams({ returnTo: rebookIntent ? '/planner/new-plan' : '/planner', draft: 'pending' })
      storePendingEventDraft({
        prompt: trimmed,
        timestamp: Date.now(),
        intent: rebookIntent ? 'rebook' : undefined,
      })
      router.push(`/signup/builder?${signupParams.toString()}`)
    }
  }

  /**
   * Handles form submit from button activation.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formDraft = new FormData(event.currentTarget).get('draft')
    void startPlanner(typeof formDraft === 'string' && formDraft.trim() ? formDraft : draftRef.current?.value ?? draft)
  }

  /**
   * Sends on Enter while preserving Shift+Enter for multiline drafting.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void startPlanner()
    }
  }

  return (
    <div className={cn('rounded-lg border border-tan bg-cream p-3 shadow-sm', className)}>
      <h2 className="font-display text-[29px] font-semibold leading-tight text-ink sm:text-[31px]">What do you want to host?</h2>

      <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-tan bg-cream-deep p-2.5">
        <div>
          <textarea
            id="hero-chat-input"
            ref={draftRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              const el = event.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={handleKeyDown}
            name="draft"
            rows={3}
            className="max-h-36 min-h-[48px] w-full resize-none overflow-y-hidden border-0 bg-transparent text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:ring-0"
            placeholder="Describe your next event..."
            aria-label="Describe the event you want to host"
            disabled={isSubmitting}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-ink-soft">Approval required before booking.</p>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-md bg-clay px-5 py-2 text-[16px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Send event draft"
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send
            </button>
          </div>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {samplePrompts.map((sample) => (
          <button
            key={sample.prompt}
            type="button"
            onClick={() => {
              if ('intent' in sample && sample.intent === 'rebook') {
                void startPlanner(sample.prompt)
                return
              }
              setDraft(sample.prompt)
            }}
            className="rounded-full border border-tan bg-cream px-3.5 py-0.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay-deep"
          >
            {sample.label}
          </button>
        ))}
      </div>
    </div>
  )
}
