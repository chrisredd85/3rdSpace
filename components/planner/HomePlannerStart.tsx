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
import { cn } from '@/lib/utils'

interface HomePlannerStartProps {
  className?: string
}

const samplePrompts = [
  'Monthly founder dinner for 24 in Hayes Valley',
  'Supper club for 18 in the Mission, cocktails and a photographer',
  'Rebook my June rooftop mixer — same venue, new date',
]

/**
 * Public event creation composer for the homepage.
 */
export function HomePlannerStart({ className }: HomePlannerStartProps) {
  const router = useRouter()
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const draftRef = useRef<HTMLTextAreaElement>(null)

  /**
   * Sends the draft prompt to the planner route.
   */
  function startPlanner(value = draftRef.current?.value ?? draft) {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    router.push(`/planner?draft=${encodeURIComponent(trimmed)}`)
  }

  /**
   * Handles form submit from button activation.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formDraft = new FormData(event.currentTarget).get('draft')
    startPlanner(typeof formDraft === 'string' && formDraft.trim() ? formDraft : draftRef.current?.value ?? draft)
  }

  /**
   * Sends on Enter while preserving Shift+Enter for multiline drafting.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      startPlanner()
    }
  }

  return (
    <div className={cn('rounded-lg border border-tan bg-cream p-3 shadow-sm', className)}>
      <span className="label-caps text-ink-soft">Try it now — free</span>
      <h2 className="mt-3 font-display text-[29px] font-semibold leading-tight text-ink sm:text-[31px]">What do you want to host?</h2>
      <p className="mt-1.5 text-[15px] leading-snug text-ink-soft">
        Describe the event. The agent starts the run with venue, vendor, and money context.
      </p>

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
          <div className="mt-2 flex justify-end">
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
        {samplePrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setDraft(prompt)}
            className="rounded-full border border-tan bg-cream px-3.5 py-0.5 text-[13px] font-semibold text-ink-soft transition-colors hover:border-clay hover:text-clay-deep"
          >
            {prompt}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[14px] font-semibold text-forest">Approval required before booking or payment.</p>
    </div>
  )
}
