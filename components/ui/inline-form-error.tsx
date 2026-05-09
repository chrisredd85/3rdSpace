'use client'

import { useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'

export function InlineFormError({ message }: { message: string | null }) {
  const errorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!message) return
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [message])

  if (!message) return null

  return (
    <div
      ref={errorRef}
      role="alert"
      className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
