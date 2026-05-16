/**
 * Purpose: Provides the public homepage event creation composer.
 * Props: Accepts optional className for placement inside the homepage hero.
 * Key behaviors: Lets creators describe an event before creating an account,
 * then forwards the draft prompt into `/planner` so the Agent Planner can begin.
 */
'use client'

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, SendHorizontal, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <div className={cn('rounded-3xl border border-border bg-card/80 p-4 shadow-glow backdrop-blur-xl', className)}>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
          <Sparkles className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <p className="font-display text-lg font-bold text-foreground">What do you want to host?</p>
          <p className="text-sm text-muted-foreground">Start planning now. Sign in when you save, book, or pay.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-background/70 p-3">
        <div className="flex items-end gap-2">
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
            className="max-h-48 min-w-0 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            placeholder="Describe your next event..."
            aria-label="Describe the event you want to host"
            disabled={isSubmitting}
          />
          <Button type="submit" size="icon" className="mb-1 rounded-xl" aria-label="Start planning" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
          </Button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {samplePrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => setDraft(prompt)}
            className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-smooth hover:border-primary/40 hover:text-foreground"
          >
            {prompt}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-success" />
        Approval required before booking or payment.
      </div>
    </div>
  )
}
