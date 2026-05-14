/**
 * Purpose: Renders the first-load empty state for Agent Planner when no active plan exists.
 * Props: Accepts an `onSubmit(message)` callback so parent routes can switch into a plan
 * or later call planner creation APIs.
 * Key behaviors: Maintains controlled input state, submits on Enter or send button, and
 * displays trust signals below the chat composer.
 */
'use client'

import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Loader2, SendHorizontal, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface PlannerEmptyStateProps {
  onSubmit: (message: string) => void
  className?: string
  isSubmitting?: boolean
  title?: string
  description?: string
  showTrustSignals?: boolean
}

/**
 * Standalone centered planner empty state with chat-style input and keyboard submit.
 */
export const PlannerEmptyState = memo(function PlannerEmptyState({
  onSubmit,
  className,
  isSubmitting = false,
  title = 'What 3rdPlace do you want to create?',
  description = 'Describe your event now. Sign in when you save, book, pay, or export.',
  showTrustSignals = true,
}: PlannerEmptyStateProps) {
  const [message, setMessage] = useState('')
  const [isHydrated, setIsHydrated] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  /**
   * Submits the current message when it contains non-empty text.
   */
  function submitMessage(value = messageRef.current?.value ?? message) {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return
    onSubmit(trimmed)
    setMessage('')
  }

  /**
   * Handles form submission from button or keyboard activation.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formMessage = new FormData(event.currentTarget).get('message')
    submitMessage(typeof formMessage === 'string' && formMessage.trim() ? formMessage : messageRef.current?.value ?? message)
  }

  /**
   * Submits on Enter while preserving Shift+Enter for future multiline behavior.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitMessage()
    }
  }

  return (
    <div className={cn('flex min-h-[calc(100vh-2rem)] items-center justify-center px-4 py-10', className)}>
      <div className="w-full max-w-3xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <span className="font-display text-2xl font-bold text-primary-foreground">3</span>
          </div>
          <h1 className="text-balance font-display text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          data-planner-hydrated={isHydrated ? 'true' : 'false'}
          className="rounded-3xl border border-border bg-card/70 p-3 shadow-card backdrop-blur-xl"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={messageRef}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value)
                autoResize(event.target)
              }}
              onKeyDown={handleKeyDown}
              name="message"
              rows={3}
              className="max-h-48 min-w-0 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
              placeholder="Describe your next event..."
              aria-label="Describe your event"
              disabled={isSubmitting || !isHydrated}
            />
            <Button
              type="submit"
              size="icon"
              className="mb-1 rounded-xl"
              aria-label="Send message"
              disabled={isSubmitting || !isHydrated}
            >
              {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
            </Button>
          </div>
        </form>

        {showTrustSignals ? (
          <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex min-w-0 items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <span className="break-words">No account required to start. Approval required before booking or payment.</span>
            </span>
            <span className="shrink-0 text-right">Powered by 3rdPlace Agent v2.4</span>
          </div>
        ) : null}
      </div>
    </div>
  )
})

PlannerEmptyState.displayName = 'PlannerEmptyState'
