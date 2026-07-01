'use client'

import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MobileChatComposer({
  value,
  isSubmitting,
  onChange,
  onSend,
}: {
  value: string
  isSubmitting: boolean
  onChange: (value: string) => void
  onSend: () => void
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value.trim() || isSubmitting) return
    onSend()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="sticky bottom-[calc(env(safe-area-inset-bottom)_+_0.75rem)] z-20 rounded-xl border border-tan bg-cream/95 p-3 shadow-card backdrop-blur"
      aria-label="Ask the agent"
    >
      <label htmlFor="mobile-agent-composer" className="sr-only">
        Ask the agent
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="mobile-agent-composer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          placeholder="Ask the agent or update the brief..."
          className="max-h-32 min-h-16 flex-1 resize-none rounded-lg border border-tan bg-cream-deep px-4 py-2.5 font-sans text-[16px] leading-6 text-ink outline-none placeholder:text-ink-faint focus:border-clay"
        />
        <button
          type="submit"
          disabled={isSubmitting || !value.trim()}
          className={cn(
            'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-clay text-primary-foreground transition-colors hover:bg-clay-deep',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
          aria-label="Send message to 3rdPlace agent"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-2 px-1 text-xs font-semibold leading-5 text-ink-soft">
        Updates the brief. Does not send externally.
      </p>
    </form>
  )
}
