'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { ArrowRight, Building2, Lock, Mail, Sparkles, Store, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loginSchema, type LoginInput } from '@/lib/validations/auth'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import { userKeys } from '@/lib/hooks/useUser'
import type { UserType } from '@/lib/types'

type PortalKey = 'builder' | 'venue' | 'vendor'

const portalConfig: Record<
  PortalKey,
  {
    title: string
    description: string
    signupHref: string
    loginHref: string
    expectedUserType: UserType
    icon: typeof Ticket
  }
> = {
  builder: {
    title: 'Event Creator',
    description: 'Sign in to manage events, bookings, and collaborators.',
    signupHref: '/signup/builder',
    loginHref: '/login/builder',
    expectedUserType: 'community_builder',
    icon: Ticket,
  },
  venue: {
    title: 'Venue Owner',
    description: 'Sign in to manage your venue, availability, and requests.',
    signupHref: '/signup/venue',
    loginHref: '/login/venue',
    expectedUserType: 'venue_owner',
    icon: Building2,
  },
  vendor: {
    title: 'Vendor',
    description: 'Sign in to manage your services, bookings, and vendor profile.',
    signupHref: '/signup/vendor',
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
  const [portalHandoff, setPortalHandoff] = useState<{ message: string; href: string } | null>(null)
  const config = portalConfig[portal]
  const redirect = getSafeInternalRedirect(searchParams.get('redirect'))

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) })

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
      addToast({ title: 'Authentication Error', description: message, variant: 'destructive' })
    }
    router.replace(config.loginHref)
  }, [addToast, config.loginHref, router, searchParams])

  const signupHref = useMemo(() => config.signupHref, [config.signupHref])

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true)
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
          addToast({ title: 'Login failed', description: result.error || 'Login failed', variant: 'destructive' })
        }
        setIsLoading(false)
        return
      }

      addToast({ title: 'Welcome back!', description: 'You have been successfully logged in.' })
      queryClient.clear()
      queryClient.setQueryData(userKeys.current, result.user)
      router.push(redirect || result.dashboardPath || '/dashboard')
    } catch {
      addToast({ title: 'Error', description: 'Connection failed. Please try again.', variant: 'destructive' })
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
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
        addToast({ title: 'Google sign in failed', description: error.message, variant: 'destructive' })
        setIsGoogleLoading(false)
      }
    } catch {
      addToast({ title: 'Error', description: 'Connection failed. Please try again.', variant: 'destructive' })
      setIsGoogleLoading(false)
    }
  }

  const Icon = config.icon

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-60" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">3rdPlace</span>
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-border bg-gradient-card p-8 shadow-card">
          {/* Header */}
          <div className="mb-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
              <Icon className="h-7 w-7 text-primary-foreground" />
            </div>
            <h1 className="font-display text-2xl font-bold">{config.title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{config.description}</p>
          </div>

          {/* Wrong portal banner */}
          {portalHandoff && (
            <div className="mb-5 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
              <p className="text-sm text-yellow-200">{portalHandoff.message}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="hero" onClick={() => router.push(portalHandoff.href)}>
                  Go to correct portal
                </Button>
                <Button size="sm" variant="glass" onClick={() => setPortalHandoff(null)}>
                  Stay here
                </Button>
              </div>
            </div>
          )}

          {/* Google */}
          <Button
            type="button"
            variant="glass"
            className="w-full"
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

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-3 text-muted-foreground">or continue with email</span>
            </div>
          </div>

          {/* Email form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-foreground">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" placeholder="you@example.com" className="pl-10" {...register('email')} />
              </div>
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type="password" placeholder="••••••••" className="pl-10" {...register('password')} />
              </div>
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <Button variant="hero" type="submit" className="w-full" disabled={isLoading || isGoogleLoading}>
              {isLoading ? 'Signing in...' : <>Sign in <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href={signupHref} className="font-medium text-primary hover:underline">
              Start planning →
            </Link>
          </p>

          {portal === 'builder' && (
            <div className="mt-6 flex items-center justify-center gap-3 text-xs text-muted-foreground/60">
              <Link href="/login/venue" className="hover:text-muted-foreground transition-smooth">Venue partner login</Link>
              <span>·</span>
              <Link href="/login/vendor" className="hover:text-muted-foreground transition-smooth">Vendor login</Link>
            </div>
          )}
          {portal !== 'builder' && (
            <div className="mt-6 text-center text-xs text-muted-foreground/60">
              <Link href="/login/builder" className="hover:text-muted-foreground transition-smooth">← Back to Event Creator login</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
