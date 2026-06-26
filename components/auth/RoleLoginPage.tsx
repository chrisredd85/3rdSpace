'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowRight, Building2, Eye, EyeOff, Lock, Mail, Store, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loginSchema, type LoginInput } from '@/lib/validations/auth'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { InlineFormError } from '@/components/ui/inline-form-error'
import { userKeys } from '@/lib/hooks/useUser'
import type { UserType } from '@/lib/types'

type PortalKey = 'builder' | 'venue' | 'vendor'

const portalConfig: Record<
  PortalKey,
  {
    title: string
    description: string
    signupHref: string
    signupLabel: string
    loginHref: string
    expectedUserType: UserType
    icon: typeof Ticket
  }
> = {
  builder: {
    title: 'Event Creator',
    description: 'Sign in to manage events, bookings, and collaborators.',
    signupHref: '/signup/builder',
    signupLabel: 'Start running events ->',
    loginHref: '/login/builder',
    expectedUserType: 'community_builder',
    icon: Ticket,
  },
  venue: {
    title: 'Venue Owner',
    description: 'Sign in to manage your venue, availability, and requests.',
    signupHref: '/signup/venue',
    signupLabel: 'List my venue ->',
    loginHref: '/login/venue',
    expectedUserType: 'venue_owner',
    icon: Building2,
  },
  vendor: {
    title: 'Vendor',
    description: 'Sign in to manage your services, bookings, and vendor profile.',
    signupHref: '/signup/vendor',
    signupLabel: 'List my services ->',
    loginHref: '/login/vendor',
    expectedUserType: 'vendor',
    icon: Store,
  },
}

function getSafeInternalRedirect(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  return value
}

export function RoleLoginPage({ portal }: { portal: PortalKey }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [portalHandoff, setPortalHandoff] = useState<{ message: string; href: string } | null>(null)
  const config = portalConfig[portal]
  const redirect = getSafeInternalRedirect(searchParams.get('redirect'))

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })
  const emailValue = watch('email')
  const passwordValue = watch('password')

  useEffect(() => {
    if (loginError) setLoginError(null)
  }, [emailValue, passwordValue])

  useEffect(() => {
    const error = searchParams.get('error')
    const message = searchParams.get('message')
    if (!error || !message) return

    if (error === 'wrong_portal') {
      const actualPortal = message.toLowerCase().includes('venue owner')
        ? '/login/venue'
        : message.toLowerCase().includes('vendor')
          ? '/login/vendor'
          : '/login/builder'
      setPortalHandoff({ message, href: actualPortal })
    } else {
      setLoginError(message)
    }
    router.replace(config.loginHref)
  }, [config.loginHref, router, searchParams])

  const signupHref = config.signupHref

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true)
    setLoginError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password, expectedUserType: config.expectedUserType }),
      })
      const result = await response.json()

      if (!response.ok || !result.success) {
        if (response.status === 403 && result.expectedLoginPath) {
          setPortalHandoff({ message: result.error || 'This account belongs to a different portal.', href: result.expectedLoginPath })
        } else {
          setLoginError(result.error || 'Login failed')
        }
        setIsLoading(false)
        return
      }

      addToast({ title: 'Welcome back!', description: 'You have been successfully logged in.' })
      queryClient.clear()
      queryClient.setQueryData(userKeys.current, result.user)
      router.push(redirect || result.dashboardPath || '/dashboard')
    } catch {
      setLoginError('Connection failed. Please try again.')
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
    setLoginError(null)
    try {
      const supabase = createClient()
      const callbackUrl = new URL('/auth/callback', window.location.origin)
      callbackUrl.searchParams.set('expected_user_type', config.expectedUserType)
      if (redirect) callbackUrl.searchParams.set('next', redirect)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl.toString() },
      })
      if (error) {
        setLoginError(error.message)
        setIsGoogleLoading(false)
      }
    } catch {
      setLoginError('Connection failed. Please try again.')
      setIsGoogleLoading(false)
    }
  }

  const Icon = config.icon

  return (
    <div className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <header className="mx-auto flex max-w-[920px] items-center">
        <Link href="/" className="font-display text-[24px] font-semibold tracking-tight text-clay">
          3rdPlace
        </Link>
      </header>

      <main className="mx-auto mt-10 w-full max-w-[460px] pb-16 sm:mt-14">
        <div className="mb-7 text-center">
          <p className="label-caps text-clay-deep">Sign in</p>
          <h1 className="mt-3 font-display text-[42px] font-semibold leading-[1.02] text-ink sm:text-[54px]">{config.title}</h1>
          <p className="mx-auto mt-3 max-w-sm text-[16px] leading-relaxed text-ink-soft">{config.description}</p>
        </div>

        <div className="rounded-lg border border-tan bg-cream p-6 shadow-sm sm:p-8">
          <div className="mb-7 flex items-center gap-3 border-b border-tan pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="label-caps text-clay-deep">{portal === 'builder' ? 'Creator portal' : `${portal} portal`}</p>
              <p className="mt-1 text-[14px] text-ink-soft">Use the account tied to this role.</p>
            </div>
          </div>

          {portalHandoff && (
            <div className="mb-5 rounded-md border border-ochre bg-ochre-tint p-4">
              <p className="text-[14px] leading-relaxed text-ink-soft">{portalHandoff.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="hero" onClick={() => router.push(portalHandoff.href)}>
                  Go to correct portal
                </Button>
                <Button size="sm" variant="glass" onClick={() => setPortalHandoff(null)} className="rounded-md border border-tan bg-cream">
                  Stay here
                </Button>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="glass"
            className="w-full rounded-md border border-tan bg-cream-deep text-ink hover:border-clay hover:bg-cream"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || isLoading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
          </Button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-tan" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-cream px-3 text-ink-faint">or continue with email</span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[13px] font-semibold text-ink-soft">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <Input id="email" type="email" placeholder="you@example.com" className="rounded-md border-tan bg-cream-deep pl-10" {...register('email')} />
              </div>
              {errors.email && <p className="text-xs text-brick">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[13px] font-semibold text-ink-soft">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <Input
                  id="password"
                  type={isPasswordVisible ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="rounded-md border-tan bg-cream-deep pl-10 pr-12"
                  {...register('password')}
                />
                <button
                  type="button"
                  aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={isPasswordVisible}
                  onClick={() => setIsPasswordVisible((current) => !current)}
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
                >
                  {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-brick">{errors.password.message}</p>}
            </div>

            <InlineFormError message={loginError} />

            <div role="group" aria-label="Login actions" className="grid gap-3 sm:grid-cols-2">
              <Button variant="hero" type="submit" className="w-full rounded-md" disabled={isLoading || isGoogleLoading}>
                {isLoading ? 'Signing in...' : <>Sign in <ArrowRight className="h-4 w-4" /></>}
              </Button>
              <Link
                href={signupHref}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-tan bg-cream-deep px-4 text-[15px] font-semibold text-ink transition-colors hover:border-clay hover:bg-cream hover:text-clay-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
              >
                Create account
              </Link>
            </div>
          </form>

          {portal === 'builder' && (
            <div
              aria-label="Partner login links"
              className="mt-6 flex flex-col items-center justify-center gap-1 text-center text-xs text-ink-faint"
            >
              <Link href="/login/venue" className="transition-colors hover:text-clay">Venue partner login</Link>
              <Link href="/login/vendor" className="transition-colors hover:text-clay">Vendor login</Link>
            </div>
          )}
          {portal !== 'builder' && (
            <div className="mt-6 text-center text-xs text-ink-faint">
              <Link href="/login/builder" className="transition-colors hover:text-clay">&lt;- Back to Event Creator login</Link>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
