'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HERO_CHAT_ANCHOR_ID = 'hero-chat'
const HERO_CHAT_INPUT_ID = 'hero-chat-input'

function focusHeroChat() {
  if (typeof window === 'undefined') return
  const wrapper = document.getElementById(HERO_CHAT_ANCHOR_ID)
  const input = document.getElementById(HERO_CHAT_INPUT_ID) as HTMLTextAreaElement | null
  wrapper?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  window.setTimeout(() => input?.focus(), 350)
}

interface StartPlanningButtonProps {
  className?: string
  children: ReactNode
}

export function StartPlanningButton({ className, children }: StartPlanningButtonProps) {
  return (
    <Button variant="hero" size="xl" className={className} onClick={focusHeroChat}>
      {children}
    </Button>
  )
}

export function FloatingStartChip() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    function onScroll() {
      const heroChat = document.getElementById(HERO_CHAT_ANCHOR_ID)
      if (!heroChat) return
      const rect = heroChat.getBoundingClientRect()
      setShow(rect.bottom < 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      onClick={focusHeroChat}
      aria-label="Jump to event composer"
      className={cn(
        'fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-gradient-brand px-5 py-3 text-sm font-bold text-primary-foreground shadow-glow transition-all duration-300',
        show
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-16 opacity-0'
      )}
    >
      Start planning <ArrowRight className="h-4 w-4" />
    </button>
  )
}
