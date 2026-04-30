'use client'

import { useState } from 'react'
import { AlertCircle, Loader2, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type SendInvoiceModalProps = {
  invoiceId: string
  invoiceNumber: string
  isOpen: boolean
  defaultEmail?: string
  onClose: () => void
  onSent?: () => void
}

/**
 * Sends an invoice email to a client address.
 */
export function SendInvoiceModal({
  invoiceId,
  invoiceNumber,
  isOpen,
  defaultEmail = '',
  onClose,
  onSent,
}: SendInvoiceModalProps) {
  const [email, setEmail] = useState(defaultEmail)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const sendInvoice = async () => {
    setIsSending(true)
    setError(null)

    try {
      const response = await fetch(`/api/vendor/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email || undefined }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to send invoice')

      onSent?.()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Unable to send invoice')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-card/40 shadow-xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">Send invoice</h2>
            <p className="mt-1 text-sm text-muted-foreground">{invoiceNumber}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="rounded-lg p-2 text-muted-foreground hover:bg-sidebar-accent/40 hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-foreground">
            Client email
            <Input
              className="mt-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="client@example.com"
            />
          </label>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={sendInvoice} disabled={isSending}>
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
