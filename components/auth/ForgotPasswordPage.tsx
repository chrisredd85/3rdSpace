'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineFormError } from '@/components/ui/inline-form-error'
import { createClient } from '@/lib/supabase/client'

function getPortalLogin(portal: string | null) {
  if (portal === 'venue') return '/login/venue'
  if (portal === 'vendor') return '/login/vendor'
  return '/login/builder'
}

export function ForgotPasswordPage({ portal }: { portal: string | null }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const loginHref = getPortalLogin(portal)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter the email tied to your 3rdPlace account.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setStatus(null)

    try {
      const supabase = createClient()
      const redirectTo = new URL('/auth/callback', window.location.origin)
      redirectTo.searchParams.set('next', `${loginHref}?password_reset=sent`)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: redirectTo.toString(),
      })
      if (resetError) {
        setError(resetError.message)
        return
      }
      setStatus('If that email has a 3rdPlace account, a reset link is on the way.')
    } catch {
      setError('Password reset is temporarily unavailable. Try again in a moment.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <header className="mx-auto flex max-w-[920px] items-center justify-between">
        <Link href="/" className="font-display text-[24px] font-semibold tracking-tight text-clay">
          3rdPlace
        </Link>
        <Link href={loginHref} className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink-soft transition-colors hover:text-clay">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
      </header>

      <main className="mx-auto mt-10 w-full max-w-[460px] pb-16 sm:mt-14">
        <div className="mb-7 text-center">
          <p className="label-caps text-clay-deep">Account recovery</p>
          <h1 className="mt-3 font-display text-[42px] font-semibold leading-[1.02] text-ink sm:text-[54px]">Reset your password</h1>
          <p className="mx-auto mt-3 max-w-sm text-[16px] leading-relaxed text-ink-soft">
            Enter the email tied to your creator, venue, or vendor account. We will send a secure reset link.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-tan bg-cream p-6 shadow-sm sm:p-8">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-[13px] font-semibold text-ink-soft">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <Input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="rounded-md border-tan bg-cream-deep pl-10"
              />
            </div>
          </div>
          <InlineFormError message={error} />
          {status ? (
            <p role="status" className="mt-4 rounded-md border border-sage bg-sage/10 p-3 text-[14px] leading-5 text-forest">
              {status}
            </p>
          ) : null}
          <Button
            type="submit"
            className="mt-5 w-full rounded-md bg-clay font-semibold text-primary-foreground hover:bg-clay-deep"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Sending reset link...' : 'Send reset link'}
          </Button>
        </form>
      </main>
    </div>
  )
}
