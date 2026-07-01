'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Ticket,
  Building2,
  Music2,
  Eye,
  EyeOff,
  Zap,
  Users,
  Store,
  ExternalLink,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { InlineFormError } from '@/components/ui/inline-form-error'
import { TicketingSetupGuide } from '@/components/auth/TicketingSetupGuide'
import { migratePlannerDraftToServer } from '@/lib/planner/migrateDraft'
import { migratePendingEventDraftToServer } from '@/lib/planner/pendingEventDraft'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_TERMS_VERSION } from '@/lib/legal/constants'
import type { ServiceType, UserType, VenueType } from '@/lib/types'

// ─── Shared primitives ───────────────────────────────────────────────────────

function AuthShell({
  eyebrow,
  title,
  subtitle,
  alreadySignedInWarning = false,
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  alreadySignedInWarning?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="auth-product-shell min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <header className="mx-auto flex max-w-[920px] items-center justify-between">
        <Link href="/" className="font-display text-[24px] font-semibold tracking-tight text-clay">
          3rdPlace
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-ink-soft transition-colors hover:text-clay"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
      </header>

      <main className="mx-auto mt-8 w-full max-w-[760px] pb-16 sm:mt-12">
        <div className="rounded-lg border border-tan bg-cream p-5 shadow-sm sm:p-8">
          {alreadySignedInWarning ? <AlreadySignedInBanner /> : null}
          <p className="label-caps text-clay-deep">{eyebrow}</p>
          <h1 className="mt-3 font-display text-[38px] font-semibold leading-[1.02] text-ink sm:text-[54px]">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-soft">{subtitle}</p>}
          <div className="mt-7 space-y-5">{children}</div>
        </div>
        <p className="mt-6 text-center text-[14px] text-ink-soft">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-clay-deep hover:underline">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  )
}

function AlreadySignedInBanner() {
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      window.location.replace(window.location.pathname)
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="mb-6 rounded-md border border-ochre bg-ochre-tint p-4 text-[14px] text-ink-soft">
      <p className="font-semibold text-ink">You&apos;re already signed in.</p>
      <p className="mt-1">Sign out to create a new account, or go back to your planner.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="rounded-md bg-clay px-4 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-clay-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? 'Signing out...' : 'Sign out and continue'}
        </button>
        <Link href="/planner" className="rounded-md border border-tan bg-cream px-4 py-2 text-xs font-bold text-ink transition-colors hover:border-clay">
          Back to planner
        </Link>
      </div>
    </div>
  )
}

function getSignupAnonymousId() {
  if (typeof window === 'undefined') return null
  const storageKey = 'thirdplace_signup_anonymous_id'
  const existing = window.localStorage.getItem(storageKey)
  if (existing) return existing
  const next = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(storageKey, next)
  return next
}

function trackSignupStep(input: {
  role: UserType
  eventName: 'signup_step_viewed' | 'signup_step_completed'
  step: number
  totalSteps: number
  method?: 'email' | 'google'
  metadata?: Record<string, unknown>
}) {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify({
    role: input.role,
    event_name: input.eventName,
    step: input.step,
    total_steps: input.totalSteps,
    method: input.method,
    anonymous_id: getSignupAnonymousId(),
    metadata: input.metadata ?? {},
  })

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' })
    navigator.sendBeacon('/api/auth/signup/events', blob)
    return
  }

  void fetch('/api/auth/signup/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => undefined)
}

function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-4">
        <span className="label-caps text-ink-soft">Step {step} of {total}</span>
        <span className="font-mono text-[11px] text-ink-faint">{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-colors ${
              i + 1 <= step ? 'bg-clay' : 'bg-tan'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-[13px] font-semibold leading-normal text-ink-soft">{label}</Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function LegalAgreementCheckbox({
  checked,
  onChange,
  error,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string
}) {
  return (
    <div className="rounded-md border border-tan bg-cream-deep p-4">
      <label className="flex items-start gap-3 text-[14px] leading-6 text-ink-soft">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-tan text-clay focus:ring-clay"
        />
        <span>
          I agree to the{' '}
          <Link href="/terms" target="_blank" className="font-semibold text-clay underline-offset-4 hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" target="_blank" className="font-semibold text-clay underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {error ? (
        <p className="mt-2 text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder = '••••••••',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [isVisible, setIsVisible] = useState(false)
  const Icon = isVisible ? EyeOff : Eye

  return (
    <div className="relative">
      <Input
        aria-label="Password"
        type={isVisible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className="pr-12"
      />
      <button
        type="button"
        aria-label={isVisible ? 'Hide password' : 'Show password'}
        aria-pressed={isVisible}
        onClick={() => setIsVisible((current) => !current)}
        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-cream hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/30"
      >
        <Icon className="h-4 w-4" />
      </button>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: string[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o)
        return (
          <button
            type="button"
            key={o}
            onClick={() => onToggle(o)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-smooth ${
              active
                ? 'border-clay bg-clay-tint text-clay-deep'
                : 'border-tan bg-cream text-ink-soft hover:border-clay hover:text-clay-deep'
            }`}
          >
            {active && <Check className="h-3.5 w-3.5 text-clay" />}
            {o}
          </button>
        )
      })}
    </div>
  )
}

function ToggleRow({
  checked,
  onChange,
  title,
  description,
  icon,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  description?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-md border border-tan bg-cream px-4 py-3 text-left transition-colors hover:border-clay"
    >
      <span className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 text-clay">{icon}</span> : null}
        <span>
          <span className="block text-[15px] font-semibold text-ink">{title}</span>
          {description ? <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{description}</span> : null}
        </span>
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-forest bg-forest-tint' : 'border-tan bg-cream-deep'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-cream shadow-sm transition-transform ${
            checked ? 'translate-x-5 border border-forest' : 'translate-x-1 border border-tan'
          }`}
        />
      </span>
    </button>
  )
}

function NestedReveal({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-r-lg border-l-4 border-clay/40 bg-clay-tint/35 py-4 pl-4 pr-3">
      {children}
    </div>
  )
}

// ─── Role selector ────────────────────────────────────────────────────────────

function RoleSelector({
  alreadySignedInWarning = false,
}: {
  alreadySignedInWarning?: boolean
}) {
  const roles = [
    {
      href: '/signup/builder',
      icon: <Users className="h-5 w-5" />,
      label: 'Creator',
      title: 'Run events',
      description: 'I host gatherings and want to execute them faster.',
    },
    {
      href: '/signup/venue',
      icon: <Building2 className="h-5 w-5" />,
      label: 'Venue',
      title: 'List my venue',
      description: 'I own or operate a room hosts can book.',
    },
    {
      href: '/signup/vendor',
      icon: <Store className="h-5 w-5" />,
      label: 'Vendor',
      title: 'List my services',
      description: 'I book photo, catering, DJ, AV, or other event work.',
    },
  ]

  return (
    <div className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8">
      <header className="mx-auto flex max-w-[1040px] items-center justify-between">
        <Link href="/" className="font-display text-[24px] font-semibold tracking-tight text-clay">
          3rdPlace
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[1040px] pb-20 pt-12">
        {alreadySignedInWarning ? <AlreadySignedInBanner /> : null}
        <div className="max-w-3xl">
          <p className="label-caps text-clay-deep">Signup</p>
          <h1 className="mt-3 font-display text-[48px] font-semibold leading-[1] text-ink sm:text-[76px]">Which one are you?</h1>
          <p className="mt-4 text-[18px] leading-relaxed text-ink-soft">Pick the role that fits. You can change later.</p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {roles.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-tan bg-cream p-6 shadow-sm transition-colors hover:border-clay"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-tan bg-cream-deep text-clay">
                {item.icon}
              </div>
              <p className="label-caps mt-5 text-clay-deep">{item.label}</p>
              <h2 className="mt-4 font-display text-[34px] font-semibold leading-tight text-ink">{item.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{item.description}</p>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-[14px] text-ink-soft">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-clay-deep hover:underline">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  )
}

// ─── Builder / Creator signup ─────────────────────────────────────────────────

const creatorEventTypes = [
  'Networking mixer',
  'Founder/operator dinner',
  'Product launch',
  'Pop-up / activation',
  'Workshop / class',
  'Panel / fireside',
  'Community meetup',
  'Day party / brunch',
  'Nightlife / club night',
  'Listening party / showcase',
]
const creatorAmenities = [
  'Private / semi-private room',
  'Full bar',
  'AV / microphones',
  'Stage / speaker area',
  'Screen / projector',
  'Work tables',
  'Outdoor / patio',
  'Kitchen / catering allowed',
  'Check-in area',
  'Load-in access',
]
const ticketPlatforms = ['Eventbrite', 'Posh', 'Luma', 'Partiful']
const orgTypes = ['Promoter / Production company', 'Social group / Community', 'Brand / Agency', 'Nonprofit', 'Independent creator']

const ticketPlatformIds: Record<string, 'eventbrite' | 'posh' | 'luma' | 'partiful'> = {
  Eventbrite: 'eventbrite',
  Posh: 'posh',
  Luma: 'luma',
  Partiful: 'partiful',
}

type SignupTicketingConnection = {
  platform: 'eventbrite' | 'posh' | 'luma' | 'partiful'
  status: string
  webhook_url: string | null
}

type CreatorActivationState = {
  email: string
  requiresEmailConfirmation: boolean
  ticketingConnections: SignupTicketingConnection[]
  migratedPlanId: string | null
  migrationFailed: boolean
}

const stripeOnboardingConfig: Record<
  UserType,
  {
    dashboardPath: string
    loginPath: string
  }
> = {
  community_builder: {
    dashboardPath: '/planner',
    loginPath: '/login/builder',
  },
  venue_owner: {
    dashboardPath: '/venue',
    loginPath: '/login/venue',
  },
  vendor: {
    dashboardPath: '/vendor',
    loginPath: '/login/vendor',
  },
}

const gmailSignupReturnTo = '/planner?signup=complete&gmail=connected'
const creatorGoogleSignupNext =
  `/api/integrations/gmail/connect?returnTo=${encodeURIComponent(gmailSignupReturnTo)}`

function getStripeLoginRedirect(userType: UserType) {
  const config = stripeOnboardingConfig[userType]
  return `${config.loginPath}?redirect=${encodeURIComponent(config.dashboardPath)}`
}

type FieldErrors = Record<string, string>

function isBlank(value: string | null | undefined) {
  return !value?.trim()
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function hasPositiveNumber(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0
}

function firstError(errors: FieldErrors) {
  return Object.values(errors)[0] ?? null
}

function getAccountStepErrors(form: { fullName: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {}
  if (isBlank(form.fullName)) errors.fullName = 'Name is required.'
  if (isBlank(form.email)) {
    errors.email = 'Email is required.'
  } else if (!isValidEmail(form.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (isBlank(form.password)) errors.password = 'Password is required.'
  return errors
}

function BuilderSignupFlow({
  onBack,
  alreadySignedInWarning = false,
}: {
  onBack: () => void
  alreadySignedInWarning?: boolean
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 4
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [activationState, setActivationState] = useState<CreatorActivationState | null>(null)

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    orgName: '',
    orgType: '',
    socialHandle: '',
    website: '',
    bio: '',
    eventTypes: [] as string[],
    avgAttendance: '',
    amenities: [] as string[],
    platforms: [] as string[],
    bulkBooking: false,
    inviteCollaborators: '',
    termsAccepted: false,
  })

  useEffect(() => {
    if (inlineError) setInlineError(null)
  }, [form, inlineError])

  useEffect(() => {
    trackSignupStep({
      role: 'community_builder',
      eventName: 'signup_step_viewed',
      step,
      totalSteps: total,
      method: 'email',
    })
  }, [step, total])

  const toggle = (key: 'eventTypes' | 'amenities' | 'platforms', value: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }))
  }
  const selectedTicketPlatforms = form.platforms
    .map((platform) => ticketPlatformIds[platform])
    .filter((platform): platform is (typeof ticketPlatformIds)[keyof typeof ticketPlatformIds] => Boolean(platform))

  const getStepErrors = (targetStep = step): FieldErrors => {
    if (targetStep === 1) return getAccountStepErrors(form)
    if (targetStep === 2) {
      const errors: FieldErrors = {}
      if (isBlank(form.orgName)) errors.orgName = 'Organization name is required.'
      if (isBlank(form.orgType)) errors.orgType = 'Organization type is required.'
      if (isBlank(form.bio)) errors.bio = 'Short bio is required.'
      return errors
    }
    if (targetStep === 3) {
      const errors: FieldErrors = {}
      if (form.eventTypes.length === 0) errors.eventTypes = 'Select at least one event type.'
      if (!hasPositiveNumber(form.avgAttendance)) errors.avgAttendance = 'Enter average attendance.'
      if (form.amenities.length === 0) errors.amenities = 'Select at least one preferred amenity.'
      return errors
    }
    if (targetStep === 4) {
      const errors: FieldErrors = {}
      if (!form.termsAccepted && !activationState) errors.termsAccepted = 'Accept the Terms of Service and Privacy Policy to create your account.'
      return errors
    }
    return {}
  }
  const stepErrors = getStepErrors()
  const isCurrentStepValid = Object.keys(stepErrors).length === 0

  const next = () => {
    const errors = getStepErrors()
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }
    setInlineError(null)
    trackSignupStep({
      role: 'community_builder',
      eventName: 'signup_step_completed',
      step,
      totalSteps: total,
      method: 'email',
    })
    setStep((s) => Math.min(total, s + 1))
  }
  const back = () => {
    setInlineError(null)
    return step > 1 ? setStep((s) => s - 1) : onBack()
  }
  const showInlineError = (message: string, targetStep?: number) => {
    if (targetStep) setStep(targetStep)
    setInlineError(message)
  }

  const startGoogleSignup = async () => {
    if (!form.termsAccepted) {
      setInlineError('Accept the Terms of Service and Privacy Policy before continuing with Google.')
      return
    }

    setIsGoogleLoading(true)
    setInlineError(null)

    try {
      const supabase = createClient()
      const callbackUrl = new URL('/auth/callback', window.location.origin)
      callbackUrl.searchParams.set('expected_user_type', 'community_builder')
      callbackUrl.searchParams.set('auth_flow', 'signup')
      callbackUrl.searchParams.set('next', creatorGoogleSignupNext)
      callbackUrl.searchParams.set('terms_version', LEGAL_TERMS_VERSION)

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl.toString() },
      })

      if (error) {
        setInlineError(error.message)
        setIsGoogleLoading(false)
      } else {
        trackSignupStep({
          role: 'community_builder',
          eventName: 'signup_step_completed',
          step: 1,
          totalSteps: total,
          method: 'google',
        })
      }
    } catch {
      setInlineError('Connection failed. Please try again.')
      setIsGoogleLoading(false)
    }
  }

  const createAccountForActivation = async () => {
    if (activationState) {
      return
    }

    const errors = getStepErrors(4)
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }

    setIsLoading(true)
    setInlineError(null)
    try {
      const eventTypes = form.eventTypes.map((eventType) => eventType.trim()).filter(Boolean)

      if (!form.fullName.trim()) {
        showInlineError('Missing point of contact name', 1)
        setIsLoading(false)
        return
      }

      if (!form.orgName.trim()) {
        showInlineError('Missing organization name', 2)
        setIsLoading(false)
        return
      }

      if (eventTypes.length === 0) {
        showInlineError('Select at least one event type', 3)
        setIsLoading(false)
        return
      }

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType: 'community_builder',
          email: form.email.trim(),
          password: form.password,
          name: form.fullName.trim(),
          organization_name: form.orgName.trim(),
          org_type: form.orgType,
          social_handle: form.socialHandle,
          website: form.website,
          bio: form.bio,
          event_types: eventTypes,
          avg_attendance: form.avgAttendance,
          preferred_amenities: form.amenities,
          ticket_platforms: selectedTicketPlatforms,
          bulk_booking_enabled: form.bulkBooking,
          invite_collaborators: form.inviteCollaborators,
          signup_terms_version: LEGAL_TERMS_VERSION,
          signup_terms_accepted: form.termsAccepted,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        setInlineError(result.error || 'Failed to create account')
        setIsLoading(false)
        return
      }

      const ticketingConnections = Array.isArray(result.ticketingConnections)
        ? result.ticketingConnections.filter((connection: SignupTicketingConnection) => Boolean(connection?.platform))
        : []
      let migratedPlanId: string | null = null
      let migrationFailed = false

      try {
        if (!result.requiresEmailConfirmation) {
          const migratedPlan = await migratePendingEventDraftToServer() ?? await migratePlannerDraftToServer()
          migratedPlanId = migratedPlan?.plan.id ?? null
        }
      } catch (migrationError) {
        console.error('Planner draft migration failed after signup:', migrationError)
        migrationFailed = true
      }

      setActivationState({
        email: result.user?.email ?? form.email.trim(),
        requiresEmailConfirmation: Boolean(result.requiresEmailConfirmation),
        ticketingConnections,
        migratedPlanId,
        migrationFailed,
      })
      trackSignupStep({
        role: 'community_builder',
        eventName: 'signup_step_completed',
        step: 4,
        totalSteps: total,
        method: 'email',
        metadata: {
          selected_ticket_platform_count: selectedTicketPlatforms.length,
          bulk_booking_enabled: form.bulkBooking,
          gmail_prompt_shown: true,
        },
      })
      addToast({
        title: result.requiresEmailConfirmation ? 'Check your email' : migratedPlanId ? "Welcome - I've created your first plan" : 'Account created',
        description: result.requiresEmailConfirmation
          ? 'Confirm your email address before signing in to continue planning.'
          : migratedPlanId ? 'Open the planner when you are ready to continue.' : 'Your creator workspace is ready.',
      })
    } catch {
      setInlineError('An unexpected error occurred.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Creator sign-up · Step ${step} of ${total}`}
      title="Set up your Creator account"
      subtitle="Tell us about your organization and the events you throw so we can match you to the right venues and vendors."
      alreadySignedInWarning={alreadySignedInWarning}
    >
      <Stepper step={Math.min(step, total)} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="space-y-4 rounded-md border border-tan bg-cream-deep p-4">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-md border-tan bg-cream text-ink hover:border-clay hover:bg-cream"
              onClick={startGoogleSignup}
              disabled={isGoogleLoading || isLoading || !form.termsAccepted}
            >
              <GoogleIcon />
              {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
            </Button>
            <p className="text-center text-xs leading-relaxed text-ink-soft">
              Google creates your 3rdPlace creator account first. Gmail outreach permission is requested separately before 3rdPlace can send or read approved event outreach.
            </p>
            <LegalAgreementCheckbox
              checked={form.termsAccepted}
              onChange={(termsAccepted) => setForm({ ...form, termsAccepted })}
              error={inlineError?.includes('Terms of Service') ? inlineError : undefined}
            />
          </div>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-tan" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-cream px-3 text-ink-faint">or create with email</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={stepErrors.fullName}>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Alex Rivera" />
            </Field>
            <Field label="Work email" error={stepErrors.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alex@brand.com" />
            </Field>
          </div>
          <Field label="Password" error={stepErrors.password}>
            <PasswordInput value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization / brand / collective" error={stepErrors.orgName}>
              <Input value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} placeholder="Sunset Social Club" />
            </Field>
            <Field label="Type of organization" error={stepErrors.orgType}>
              <select
                value={form.orgType}
                onChange={(e) => setForm({ ...form, orgType: e.target.value })}
                className="flex h-12 w-full rounded-md border border-tan bg-cream px-4 py-3 text-[15px] text-ink outline-none transition-colors focus:border-clay"
              >
                <option value="">Select...</option>
                {orgTypes.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary social handle">
              <Input value={form.socialHandle} onChange={(e) => setForm({ ...form, socialHandle: e.target.value })} placeholder="@sunsetsocial" />
            </Field>
            <Field label="Website (optional)">
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
            </Field>
          </div>
          <Field label="Short bio" error={stepErrors.bio}>
            <Textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="What's your scene? Who do you throw events for?" />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5 animate-fade-in sm:space-y-6">
          <div>
            <Label className="mb-2 block">What types of events do you host?</Label>
            <ChipGroup options={creatorEventTypes} selected={form.eventTypes} onToggle={(v) => toggle('eventTypes', v)} />
            {stepErrors.eventTypes ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.eventTypes}
              </p>
            ) : null}
          </div>
          <Field label="Average attendance per event" error={stepErrors.avgAttendance}>
            <Input value={form.avgAttendance} onChange={(e) => setForm({ ...form, avgAttendance: e.target.value })} placeholder="e.g. 150" />
          </Field>
          <div>
            <Label className="mb-2 block">Amenities that matter most when picking a space</Label>
            <ChipGroup options={creatorAmenities} selected={form.amenities} onToggle={(v) => toggle('amenities', v)} />
            {stepErrors.amenities ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.amenities}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block text-[13px] font-semibold text-ink-soft">Ticketing platforms you use (optional)</Label>
            <p className="mb-3 text-[13px] text-ink-soft">
              This only personalizes setup. Connect Eventbrite, Luma, Posh, Partiful, or CSV imports from Tickets after your first event is created.
            </p>
            <ChipGroup options={ticketPlatforms} selected={form.platforms} onToggle={(v) => toggle('platforms', v)} />
            {stepErrors.platforms ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.platforms}
              </p>
            ) : null}
          </div>

          <TicketingSetupGuide
            selectedPlatforms={form.platforms}
            compact
            persistConnections={Boolean(activationState && !activationState.requiresEmailConfirmation)}
          />

          <ToggleRow
            checked={form.bulkBooking}
            onChange={(bulkBooking) => setForm({ ...form, bulkBooking })}
            title="Prepare reusable event templates"
            description="Run recurring events? 3rdPlace can help turn approved plans into repeatable playbooks, with every new send, hold, or payment still approval-gated."
          />

          {form.bulkBooking && (
            <NestedReveal>
              <p className="label-caps text-ochre">Pre-authorization preview</p>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
                The agent can prepare outreach batches, but booking, payment, and deposits still require your approval.
              </p>
            </NestedReveal>
          )}

          <Field label="Invite collaborators (comma-separated emails, optional)">
            <Textarea
              rows={2}
              value={form.inviteCollaborators}
              onChange={(e) => setForm({ ...form, inviteCollaborators: e.target.value })}
              placeholder="co-host@brand.com, manager@brand.com"
            />
          </Field>

          {!activationState ? (
            <LegalAgreementCheckbox
              checked={form.termsAccepted}
              onChange={(termsAccepted) => setForm({ ...form, termsAccepted })}
              error={stepErrors.termsAccepted}
            />
          ) : null}

          <div className="rounded-md border border-tan bg-cream-deep p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-tan bg-cream text-clay">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-[24px] font-semibold leading-tight text-ink">Connect Gmail for approved outreach</h2>
                <p className="mt-2 text-[14px] leading-6 text-ink-soft">
                  3rdPlace sends approved venue and vendor outreach from your Gmail and reads replies into your event plan.
                  We never read your general inbox, and every outbound message still requires approval unless you later set an explicit outreach policy.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Send', 'Only the outreach messages you approve'],
              ['Read', 'Only replies to threads we started'],
              ['Mark as read', "Only on processed reply threads, so they don't clutter your inbox"],
            ].map(([title, copy]) => (
              <div key={title} className="rounded-md border border-tan bg-cream p-4">
                <p className="label-caps text-clay-deep">{title}</p>
                <p className="mt-2 text-[13px] leading-5 text-ink-soft">{copy}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-tan bg-cream p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-cream-deep text-clay">
              {activationState ? <Check className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
              </div>
              <div>
                <p className="font-semibold text-ink">{activationState ? 'Creator workspace' : 'Available after account creation'}</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {!activationState
                    ? 'Create your account on this step, then choose whether to connect Gmail now or finish it later from Settings when you are ready to approve outreach.'
                    : activationState.requiresEmailConfirmation
                    ? `Check ${activationState.email} and confirm your email before signing in.`
                    : `${activationState.email ?? form.email} is ready for this workspace session.`}
                </p>
              </div>
            </div>
          </div>

          {activationState ? (
            <div className="rounded-md border border-tan bg-cream-deep p-4 text-[13px] leading-5 text-ink-soft">
              {selectedTicketPlatforms.length > 0
                ? 'Ticketing preferences are saved. You can finish Eventbrite OAuth, webhook URLs, Partiful links, and ticket imports from Tickets after entering the planner.'
                : 'Ticketing setup was skipped. You can connect Eventbrite, Luma, Posh, or Partiful from Tickets when you need imports.'}
            </div>
          ) : null}

          {activationState ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] text-ink-soft">You can disconnect anytime from Settings → Integrations.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {activationState.requiresEmailConfirmation ? (
                  <Button type="button" onClick={() => router.push(getStripeLoginRedirect('community_builder'))}>
                    Go to sign in
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button asChild type="button">
                      <Link href={`/api/integrations/gmail/connect?returnTo=${encodeURIComponent(gmailSignupReturnTo)}`}>
                        Connect Gmail
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => router.push('/planner?signup=complete&gmail_skipped=1')}
                    >
                      I&apos;ll connect later
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-8 space-y-4 sm:mt-10">
        <InlineFormError message={inlineError} />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {!activationState ? (
            <Button variant="glass" onClick={back} className="w-full sm:w-auto">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          ) : (
            <div />
          )}
          {step < 4 ? (
            <Button variant="hero" onClick={next} disabled={!isCurrentStepValid} className="w-full sm:w-auto">
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : step === 4 && !activationState ? (
            <Button variant="hero" onClick={createAccountForActivation} disabled={isLoading || !isCurrentStepValid} className="w-full sm:w-auto">
              <Ticket className="h-4 w-4" />
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          ) : (
            <div />
          )}
        </div>
      </div>
    </AuthShell>
  )
}

// ─── Venue signup ─────────────────────────────────────────────────────────────

const venueTypes = ['Bar', 'Club / Nightlife', 'Restaurant', 'Loft / Studio', 'Rooftop', 'Warehouse', 'Gallery', 'Outdoor']
const venueTypeIds: Record<string, VenueType> = {
  Bar: 'other',
  'Club / Nightlife': 'other',
  Restaurant: 'restaurant',
  'Loft / Studio': 'loft_warehouse',
  Rooftop: 'rooftop',
  Warehouse: 'loft_warehouse',
  Gallery: 'gallery',
  Outdoor: 'other',
}
const venueAmenities = ['DJ booth', 'Stage', 'PA / sound system', 'Lighting rig', 'Full bar', 'Kitchen', 'Green room', 'Coat check', 'Parking', 'Loading dock', 'ADA access', 'Wifi']
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const venueCommercialTerms = [
  {
    id: 'minimum_spend',
    label: 'Minimum spend floor',
    description: 'Your required food and beverage floor when the room is held for an event.',
  },
  {
    id: 'bar_consumption_chi',
    label: 'Bar consumption CHI',
    description: '3rdPlace calculates the recommended host incentive from expected beverage demand.',
  },
  {
    id: 'ticket_chi',
    label: 'Ticket CHI',
    description: '3rdPlace can model a host incentive from ticketed-event performance when appropriate.',
  },
  {
    id: 'per_attendee_chi',
    label: 'Per-attendee CHI',
    description: '3rdPlace can recommend a per-attendee incentive from approved benchmarks.',
  },
] as const
type VenueCommercialTermId = typeof venueCommercialTerms[number]['id']
const defaultBarCommercialTerms: VenueCommercialTermId[] = ['minimum_spend', 'bar_consumption_chi']

function VenueSignupFlow({
  onBack,
  alreadySignedInWarning = false,
  opportunityToken = null,
}: {
  onBack: () => void
  alreadySignedInWarning?: boolean
  opportunityToken?: string | null
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 5
  const [isLoading, setIsLoading] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const [form, setForm] = useState({
    contactName: '',
    contactRole: '',
    email: '',
    phone: '',
    password: '',
    venueName: '',
    venueType: '',
    address: '',
    city: '',
    neighborhood: '',
    state: '',
    zipCode: '',
    loadingAddress: '',
    capacity: '',
    prepTime: '2',
    amenities: [] as string[],
    houseRules: '',
    isBar: false,
    supportedCommercialTerms: [] as VenueCommercialTermId[],
    minBarSpend: '',
    pricePerNight: '',
    deposit: '',
    cancellationTerms: '',
    openDays: [] as string[],
    openFrom: '18:00',
    openTo: '02:00',
    termsAccepted: false,
  })

  useEffect(() => {
    if (inlineError) setInlineError(null)
  }, [form, inlineError])

  useEffect(() => {
    trackSignupStep({
      role: 'venue_owner',
      eventName: 'signup_step_viewed',
      step,
      totalSteps: total,
      method: 'email',
    })
  }, [step, total])

  const toggle = (key: 'amenities' | 'openDays', v: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))
  }
  const toggleCommercialTerm = (termId: VenueCommercialTermId) => {
    setForm((f) => ({
      ...f,
      supportedCommercialTerms: f.supportedCommercialTerms.includes(termId)
        ? f.supportedCommercialTerms.filter((x) => x !== termId)
        : [...f.supportedCommercialTerms, termId],
    }))
  }

  const getStepErrors = (targetStep = step): FieldErrors => {
    if (targetStep === 1) {
      const errors: FieldErrors = {}
      if (isBlank(form.contactName)) errors.contactName = 'Point-of-contact name is required.'
      if (isBlank(form.contactRole)) errors.contactRole = 'Role is required.'
      if (isBlank(form.email)) {
        errors.email = 'Booking email is required.'
      } else if (!isValidEmail(form.email)) {
        errors.email = 'Enter a valid booking email.'
      }
      if (isBlank(form.phone)) errors.phone = 'Booking phone is required.'
      if (isBlank(form.password)) errors.password = 'Password is required.'
      return errors
    }
    if (targetStep === 2) {
      const errors: FieldErrors = {}
      if (isBlank(form.venueName)) errors.venueName = 'Venue name is required.'
      if (isBlank(form.venueType)) errors.venueType = 'Venue type is required.'
      if (isBlank(form.address)) errors.address = 'Main entrance address is required.'
      if (isBlank(form.city)) errors.city = 'City is required.'
      if (isBlank(form.state)) errors.state = 'State is required.'
      if (isBlank(form.zipCode)) errors.zipCode = 'ZIP is required.'
      if (!hasPositiveNumber(form.capacity)) errors.capacity = 'Maximum capacity is required.'
      return errors
    }
    if (targetStep === 3) {
      const errors: FieldErrors = {}
      if (form.amenities.length === 0) errors.amenities = 'Select at least one venue amenity.'
      if (isBlank(form.houseRules)) errors.houseRules = 'House rules are required.'
      return errors
    }
    if (targetStep === 4) {
      const errors: FieldErrors = {}
      if (!hasPositiveNumber(form.pricePerNight)) errors.pricePerNight = 'Base price per night is required.'
      if (!hasPositiveNumber(form.deposit)) errors.deposit = 'Deposit amount is required.'
      if (isBlank(form.cancellationTerms)) errors.cancellationTerms = 'Cancellation terms are required.'
      if (form.isBar && form.supportedCommercialTerms.includes('minimum_spend') && !hasPositiveNumber(form.minBarSpend)) {
        errors.minBarSpend = 'Minimum spend is required when that term is selected.'
      }
      return errors
    }
    if (targetStep === 5) {
      const errors: FieldErrors = {}
      if (form.openDays.length === 0) errors.openDays = 'Select at least one available booking day.'
      if (!form.termsAccepted) errors.termsAccepted = 'Accept the Terms of Service and Privacy Policy to create your account.'
      return errors
    }
    return {}
  }
  const stepErrors = getStepErrors()
  const isCurrentStepValid = Object.keys(stepErrors).length === 0

  const next = () => {
    const errors = getStepErrors()
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }
    setInlineError(null)
    trackSignupStep({
      role: 'venue_owner',
      eventName: 'signup_step_completed',
      step,
      totalSteps: total,
      method: 'email',
    })
    setStep((s) => Math.min(total, s + 1))
  }
  const back = () => {
    setInlineError(null)
    return step > 1 ? setStep((s) => s - 1) : onBack()
  }

  const finish = async () => {
    const errors = getStepErrors(total)
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }

    setIsLoading(true)
    setInlineError(null)
    try {
      const addressParts = form.address.split(',').map((s) => s.trim())
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType: 'venue_owner',
          email: form.email,
          password: form.password,
          name: form.contactName,
          contact_role: form.contactRole,
          phone: form.phone,
          venue_name: form.venueName,
          venue_type: venueTypeIds[form.venueType] || 'other',
          address: form.address,
          city: form.city || addressParts[1] || '',
          neighborhood: form.neighborhood,
          state: form.state || addressParts[2] || '',
          zip_code: form.zipCode || '',
          loading_address: form.loadingAddress,
          capacity: parseInt(form.capacity) || 0,
          prep_time: parseInt(form.prepTime) || 2,
          amenities: form.amenities,
          house_rules: form.houseRules,
          has_bar: form.isBar,
          supported_commercial_terms: form.isBar ? form.supportedCommercialTerms : [],
          bar_chi_pct: null,
          per_head_drink_pct: null,
          min_bar_spend: form.isBar && form.supportedCommercialTerms.includes('minimum_spend') ? parseFloat(form.minBarSpend) : null,
          price_per_night: parseFloat(form.pricePerNight) || 0,
          deposit: parseFloat(form.deposit) || 0,
          cancellation_terms: form.cancellationTerms,
          available_days: form.openDays,
          open_from: form.openFrom,
          open_to: form.openTo,
          opportunity_token: opportunityToken,
          signup_terms_version: LEGAL_TERMS_VERSION,
          signup_terms_accepted: form.termsAccepted,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        setInlineError(result.error || 'Failed to create account')
        setIsLoading(false)
        return
      }
      trackSignupStep({
        role: 'venue_owner',
        eventName: 'signup_step_completed',
        step: total,
        totalSteps: total,
        method: 'email',
        metadata: {
          venue_type: form.venueType,
          supported_commercial_terms: form.isBar ? form.supportedCommercialTerms : [],
        },
      })
      if (result.requiresEmailConfirmation) {
        addToast({ title: 'Check your email', description: 'Confirm your email address, then log in to manage your venue.' })
        router.push(getStripeLoginRedirect('venue_owner'))
        return
      }
      addToast({ title: 'Venue account created', description: 'You can connect Stripe when a paid opportunity is ready.' })
      router.push(result.redirectTo || stripeOnboardingConfig.venue_owner.dashboardPath)
    } catch {
      setInlineError('An unexpected error occurred.')
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Venue sign-up · Step ${step} of ${total}`}
      title="List your venue on 3rdPlace"
      subtitle="Show creators what makes your space special. Set your rules, your rates, and your calendar — once."
      alreadySignedInWarning={alreadySignedInWarning}
    >
      <Stepper step={step} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Point-of-contact name" error={stepErrors.contactName}>
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Jordan Lee" />
            </Field>
            <Field label="Their role" error={stepErrors.contactRole}>
              <Input value={form.contactRole} onChange={(e) => setForm({ ...form, contactRole: e.target.value })} placeholder="GM / Owner / Booker" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Booking email" error={stepErrors.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="bookings@venue.com" />
            </Field>
            <Field label="Booking phone" error={stepErrors.phone}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 555-5555" />
            </Field>
          </div>
          <Field label="Password" error={stepErrors.password}>
            <PasswordInput value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue name" error={stepErrors.venueName}>
              <Input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="The Foundry Loft" />
            </Field>
            <Field label="Venue type" error={stepErrors.venueType}>
              <select
                value={form.venueType}
                onChange={(e) => setForm({ ...form, venueType: e.target.value })}
                className="flex h-12 w-full rounded-md border border-tan bg-cream px-4 py-3 text-[15px] text-ink outline-none transition-colors focus:border-clay"
              >
                <option value="">Select...</option>
                {venueTypes.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Main entrance address" error={stepErrors.address}>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Industry Rd, Brooklyn NY" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" error={stepErrors.city}>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Brooklyn" />
            </Field>
            <Field label="Neighborhood">
              <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} placeholder="SOMA" />
            </Field>
            <Field label="State" error={stepErrors.state}>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="NY" maxLength={2} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ZIP" error={stepErrors.zipCode}>
              <Input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} placeholder="11201" />
            </Field>
            <Field label="Prep / load-in time allowed (hours)">
              <Input type="number" value={form.prepTime} onChange={(e) => setForm({ ...form, prepTime: e.target.value })} placeholder="2" />
            </Field>
          </div>
          <Field label="Loading dock address (if different)">
            <Input value={form.loadingAddress} onChange={(e) => setForm({ ...form, loadingAddress: e.target.value })} placeholder="Rear entrance — 124 Industry Rd" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-1">
            <Field label="Maximum capacity" error={stepErrors.capacity}>
              <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="250" />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">Amenities & equipment</Label>
            <ChipGroup options={venueAmenities} selected={form.amenities} onToggle={(v) => toggle('amenities', v)} />
            {stepErrors.amenities ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.amenities}
              </p>
            ) : null}
          </div>
          <div>
            <Label className="mb-2 block">Photos of the space</Label>
            <div className="rounded-md border border-tan bg-cream-deep p-4 text-[14px] leading-relaxed text-ink-soft">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-clay" />
                <div>
                  <p className="font-semibold text-ink">Add photos after signup.</p>
                  <p className="mt-1">
                    Your listing can be created now. After signup, upload interior, exterior, stage, bar, and loading-area photos from your venue profile.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <Field label="House rules" error={stepErrors.houseRules}>
            <Textarea
              rows={4}
              value={form.houseRules}
              onChange={(e) => setForm({ ...form, houseRules: e.target.value })}
              placeholder="No outside alcohol. Music off by 2am. No confetti / glitter. Smoking on patio only..."
            />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-fade-in">
          <ToggleRow
            checked={form.isBar}
            onChange={(isBar) => setForm((current) => ({
              ...current,
              isBar,
              supportedCommercialTerms: isBar && current.supportedCommercialTerms.length === 0
                ? defaultBarCommercialTerms
                : current.supportedCommercialTerms,
            }))}
            title="This venue has bar or beverage sales"
            description="Lets 3rdPlace recommend supported commercial terms. CHI rates are calculated by the system and approved before settlement."
          />

          {form.isBar && (
            <NestedReveal>
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block text-[13px] font-semibold text-ink-soft">Commercial terms you are open to</Label>
                  <p className="mb-3 text-[14px] leading-relaxed text-ink-soft">
                    Choose structures your team would consider. 3rdPlace calculates the recommended CHI for each event from attendance, event type, venue fit, and approved benchmarks.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {venueCommercialTerms.map((term) => {
                      const active = form.supportedCommercialTerms.includes(term.id)
                      return (
                        <button
                          key={term.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleCommercialTerm(term.id)}
                          className={`rounded-md border p-4 text-left transition-colors ${
                            active
                              ? 'border-clay bg-clay-tint text-clay-deep'
                              : 'border-tan bg-cream text-ink hover:border-clay'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-[14px] font-semibold">
                            {active ? <Check className="h-4 w-4 text-clay" /> : null}
                            {term.label}
                          </span>
                          <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">{term.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {form.supportedCommercialTerms.includes('minimum_spend') ? (
                  <Field label="Minimum spend floor ($)" error={stepErrors.minBarSpend}>
                    <Input type="number" value={form.minBarSpend} onChange={(e) => setForm({ ...form, minBarSpend: e.target.value })} placeholder="2000" />
                  </Field>
                ) : null}

                <div className="rounded-md border border-tan bg-cream-deep p-4 text-[14px] leading-relaxed text-ink-soft">
                  <p className="font-semibold text-ink">3rdPlace calculates CHI.</p>
                  <p className="mt-1">
                    These are supported structures, not final rates. The planner recommends terms, the organizer approves the action, and your venue approves the final CHI terms before anything is settled.
                  </p>
                </div>
              </div>
            </NestedReveal>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base price per night ($)" error={stepErrors.pricePerNight}>
              <Input type="number" value={form.pricePerNight} onChange={(e) => setForm({ ...form, pricePerNight: e.target.value })} placeholder="3500" />
            </Field>
          </div>

          <NestedReveal>
            <Field label="Deposit required ($)" error={stepErrors.deposit}>
              <Input type="number" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} placeholder="1500" />
            </Field>
          </NestedReveal>

          <Field label="Cancellation terms" error={stepErrors.cancellationTerms}>
            <Textarea
              rows={3}
              value={form.cancellationTerms}
              onChange={(e) => setForm({ ...form, cancellationTerms: e.target.value })}
              placeholder="Full refund 30+ days out. 50% refund 14-30 days. Non-refundable inside 14 days."
            />
          </Field>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block text-[13px] font-semibold text-ink-soft">Available booking days</Label>
            <ChipGroup options={weekDays} selected={form.openDays} onToggle={(v) => toggle('openDays', v)} />
            {stepErrors.openDays ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.openDays}
              </p>
            ) : null}
          </div>

          {form.openDays.length > 0 ? (
            <div className="space-y-3">
              {form.openDays.map((day) => (
                <NestedReveal key={day}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="label-caps text-clay-deep">{day}</p>
                    <p className="text-[14px] text-ink-soft">Uses the shared booking window below.</p>
                  </div>
                </NestedReveal>
              ))}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Earliest start time">
              <Input type="time" value={form.openFrom} onChange={(e) => setForm({ ...form, openFrom: e.target.value })} />
            </Field>
            <Field label="Latest end time">
              <Input type="time" value={form.openTo} onChange={(e) => setForm({ ...form, openTo: e.target.value })} />
            </Field>
          </div>
          <div className="rounded-md border border-tan bg-cream-deep p-4 text-[14px]">
            <p className="font-semibold text-ink">Calendar sync</p>
            <p className="mt-1 text-ink-soft">After signup, connect Google Calendar or import an .ics feed to prevent double-bookings automatically.</p>
          </div>

          <LegalAgreementCheckbox
            checked={form.termsAccepted}
            onChange={(termsAccepted) => setForm({ ...form, termsAccepted })}
            error={stepErrors.termsAccepted}
          />
        </div>
      )}

      <div className="mt-10 space-y-4">
        <InlineFormError message={inlineError} />
        <div className="flex items-center justify-between">
          <Button variant="glass" onClick={back}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < total ? (
            <Button variant="hero" onClick={next} disabled={!isCurrentStepValid}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="hero" onClick={finish} disabled={isLoading || !isCurrentStepValid}>
              <Building2 className="h-4 w-4" />
              {isLoading ? 'Publishing...' : 'Publish my venue listing'}
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  )
}

// ─── Vendor signup ────────────────────────────────────────────────────────────

const vendorServices = ['DJ', 'Live band', 'Photographer', 'Videographer', 'Catering', 'Bartending', 'AV / Production', 'Lighting', 'Florals', 'Security', 'Hosts / Staffing', 'Decor']
const vendorServiceTypeIds: Record<string, ServiceType> = {
  DJ: 'dj',
  'Live band': 'other',
  Photographer: 'photography',
  Videographer: 'videography',
  Catering: 'catering',
  Bartending: 'bartending',
  'AV / Production': 'av_tech',
  Lighting: 'av_tech',
  Florals: 'florist',
  Security: 'event_planning',
  'Hosts / Staffing': 'event_planning',
  Decor: 'florist',
}

function VendorSignupFlow({
  onBack,
  alreadySignedInWarning = false,
}: {
  onBack: () => void
  alreadySignedInWarning?: boolean
}) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 4
  const [isLoading, setIsLoading] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const [form, setForm] = useState({
    fullName: '',
    businessName: '',
    email: '',
    phone: '',
    password: '',
    services: [] as string[],
    serviceArea: '',
    portfolioUrl: '',
    bio: '',
    basePrice: '',
    packageName: '',
    packageDetails: '',
    depositPct: '30',
    leadTimeDays: '7',
    cancellationTerms: '',
    availableDays: [] as string[],
    emergencyAvailable: false,
    emergencyRate: '',
    termsAccepted: false,
  })

  useEffect(() => {
    if (inlineError) setInlineError(null)
  }, [form, inlineError])

  useEffect(() => {
    trackSignupStep({
      role: 'vendor',
      eventName: 'signup_step_viewed',
      step,
      totalSteps: total,
      method: 'email',
    })
  }, [step, total])

  const toggle = (key: 'services' | 'availableDays', v: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))
  }

  const getStepErrors = (targetStep = step): FieldErrors => {
    if (targetStep === 1) {
      const errors: FieldErrors = {}
      if (isBlank(form.fullName)) errors.fullName = 'Name is required.'
      if (isBlank(form.businessName)) errors.businessName = 'Business or stage name is required.'
      if (isBlank(form.email)) {
        errors.email = 'Email is required.'
      } else if (!isValidEmail(form.email)) {
        errors.email = 'Enter a valid email address.'
      }
      if (isBlank(form.phone)) errors.phone = 'Phone is required.'
      if (isBlank(form.password)) errors.password = 'Password is required.'
      return errors
    }
    if (targetStep === 2) {
      const errors: FieldErrors = {}
      if (form.services.length === 0) errors.services = 'Select at least one service.'
      if (isBlank(form.serviceArea)) errors.serviceArea = 'Service area is required.'
      if (isBlank(form.portfolioUrl)) errors.portfolioUrl = 'Portfolio or social link is required.'
      if (isBlank(form.bio)) errors.bio = 'Short bio is required.'
      return errors
    }
    if (targetStep === 3) {
      const errors: FieldErrors = {}
      if (!hasPositiveNumber(form.basePrice)) errors.basePrice = 'Base price is required.'
      if (isBlank(form.packageName)) errors.packageName = 'Starter package name is required.'
      if (isBlank(form.packageDetails)) errors.packageDetails = 'Starter package details are required.'
      if (!hasPositiveNumber(form.depositPct)) errors.depositPct = 'Deposit percentage is required.'
      if (!hasPositiveNumber(form.leadTimeDays)) errors.leadTimeDays = 'Minimum lead time is required.'
      if (isBlank(form.cancellationTerms)) errors.cancellationTerms = 'Cancellation terms are required.'
      return errors
    }
    if (targetStep === 4) {
      const errors: FieldErrors = {}
      if (form.availableDays.length === 0) errors.availableDays = 'Select at least one available day.'
      if (form.emergencyAvailable && !hasPositiveNumber(form.emergencyRate)) {
        errors.emergencyRate = 'Emergency-rate uplift is required when emergency availability is enabled.'
      }
      if (!form.termsAccepted) errors.termsAccepted = 'Accept the Terms of Service and Privacy Policy to create your account.'
      return errors
    }
    return {}
  }
  const stepErrors = getStepErrors()
  const isCurrentStepValid = Object.keys(stepErrors).length === 0

  const next = () => {
    const errors = getStepErrors()
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }
    setInlineError(null)
    trackSignupStep({
      role: 'vendor',
      eventName: 'signup_step_completed',
      step,
      totalSteps: total,
      method: 'email',
    })
    setStep((s) => Math.min(total, s + 1))
  }
  const back = () => {
    setInlineError(null)
    return step > 1 ? setStep((s) => s - 1) : onBack()
  }

  const finish = async () => {
    const errors = getStepErrors(total)
    const message = firstError(errors)
    if (message) {
      setInlineError(message)
      return
    }

    setIsLoading(true)
    setInlineError(null)
    try {
      const serviceType = form.services[0] ? vendorServiceTypeIds[form.services[0]] || 'other' : 'other'
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType: 'vendor',
          email: form.email,
          password: form.password,
          name: form.fullName,
          business_name: form.businessName,
          phone: form.phone,
          service_type: serviceType,
          services: form.services,
          service_area: form.serviceArea,
          portfolio_url: form.portfolioUrl,
          bio: form.bio,
          base_price: parseFloat(form.basePrice) || 0,
          package_name: form.packageName,
          package_details: form.packageDetails,
          deposit_pct: parseFloat(form.depositPct) || 30,
          lead_time_days: parseInt(form.leadTimeDays) || 7,
          cancellation_terms: form.cancellationTerms,
          available_days: form.availableDays,
          emergency_available: form.emergencyAvailable,
          emergency_rate_uplift: form.emergencyAvailable ? parseFloat(form.emergencyRate) : null,
          availability_notes: `Available: ${form.availableDays.join(', ')}. Lead time: ${form.leadTimeDays} days.`,
          signup_terms_version: LEGAL_TERMS_VERSION,
          signup_terms_accepted: form.termsAccepted,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        setInlineError(result.error || 'Failed to create account')
        setIsLoading(false)
        return
      }
      trackSignupStep({
        role: 'vendor',
        eventName: 'signup_step_completed',
        step: total,
        totalSteps: total,
        method: 'email',
        metadata: {
          selected_service_count: form.services.length,
          emergency_available: form.emergencyAvailable,
        },
      })
      if (result.requiresEmailConfirmation) {
        addToast({ title: 'Check your email', description: 'Confirm your email address, then log in to manage your vendor profile.' })
        router.push(getStripeLoginRedirect('vendor'))
        return
      }
      addToast({ title: 'Vendor account created', description: 'You can connect Stripe when a paid opportunity is ready.' })
      router.push(stripeOnboardingConfig.vendor.dashboardPath)
    } catch {
      setInlineError('An unexpected error occurred.')
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Vendor sign-up · Step ${step} of ${total}`}
      title="Get booked on 3rdPlace"
      subtitle="List your services, set your rates, and choose whether you're available for last-minute emergency gigs."
      alreadySignedInWarning={alreadySignedInWarning}
    >
      <Stepper step={step} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" error={stepErrors.fullName}>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Sam Carter" />
            </Field>
            <Field label="Business / stage name" error={stepErrors.businessName}>
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="DJ Solstice" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" error={stepErrors.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@vendor.com" />
            </Field>
            <Field label="Phone" error={stepErrors.phone}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 555-5555" />
            </Field>
          </div>
          <Field label="Password" error={stepErrors.password}>
            <PasswordInput value={form.password} onChange={(password) => setForm({ ...form, password })} />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">What services do you provide?</Label>
            <ChipGroup options={vendorServices} selected={form.services} onToggle={(v) => toggle('services', v)} />
            {stepErrors.services ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.services}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service area" error={stepErrors.serviceArea}>
              <Input value={form.serviceArea} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })} placeholder="NYC + tri-state, will travel" />
            </Field>
            <Field label="Portfolio / IG link" error={stepErrors.portfolioUrl}>
              <Input value={form.portfolioUrl} onChange={(e) => setForm({ ...form, portfolioUrl: e.target.value })} placeholder="https://instagram.com/..." />
            </Field>
          </div>
          <Field label="Short bio" error={stepErrors.bio}>
            <Textarea
              rows={3}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="What do you bring to a room? Notable past gigs, vibe, specialties..."
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 animate-fade-in">
          <NestedReveal>
            <p className="label-caps text-clay-deep">Pricing model</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Base / starting price ($)" error={stepErrors.basePrice}>
                <Input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} placeholder="800" />
              </Field>
              <div className="rounded-md border border-tan bg-cream px-4 py-3">
                <p className="text-[13px] font-semibold text-ink-soft">Model</p>
                <p className="mt-1 text-[15px] font-semibold text-ink">Base rate + starter package</p>
              </div>
            </div>
          </NestedReveal>

          <NestedReveal>
            <p className="mb-4 font-display text-[22px] font-semibold text-ink">Starter package</p>
            <Field label="Package name" error={stepErrors.packageName}>
              <Input value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} placeholder="4-hour open format set" />
            </Field>
            <div className="mt-4">
              <Field label="What's included" error={stepErrors.packageDetails}>
                <Textarea
                  rows={3}
                  value={form.packageDetails}
                  onChange={(e) => setForm({ ...form, packageDetails: e.target.value })}
                  placeholder="4 hours of music, basic lighting, custom playlist consult..."
                />
              </Field>
            </div>
          </NestedReveal>

          <NestedReveal>
            <p className="label-caps text-clay-deep">Deposit terms</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Deposit required (%)" error={stepErrors.depositPct}>
                <Input type="number" value={form.depositPct} onChange={(e) => setForm({ ...form, depositPct: e.target.value })} placeholder="30" />
              </Field>
              <Field label="Minimum lead time (days)" error={stepErrors.leadTimeDays}>
                <Input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} placeholder="7" />
              </Field>
            </div>
          </NestedReveal>

          <Field label="Cancellation terms" error={stepErrors.cancellationTerms}>
            <Textarea
              rows={2}
              value={form.cancellationTerms}
              onChange={(e) => setForm({ ...form, cancellationTerms: e.target.value })}
              placeholder="Deposit non-refundable inside 14 days. Full refund 30+ days out."
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            Payout setup happens through Stripe Connect when a paid booking is ready. We do not collect bank details here.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block text-[13px] font-semibold text-ink-soft">Days you&apos;re typically available</Label>
            <ChipGroup options={weekDays} selected={form.availableDays} onToggle={(v) => toggle('availableDays', v)} />
            <p className="mt-2 text-xs text-ink-soft">After signup, set specific blocked dates on your calendar.</p>
            {stepErrors.availableDays ? (
              <p className="mt-1.5 text-xs font-medium text-destructive" role="alert">
                {stepErrors.availableDays}
              </p>
            ) : null}
          </div>

          <ToggleRow
            checked={form.emergencyAvailable}
            onChange={(emergencyAvailable) => setForm({ ...form, emergencyAvailable })}
            title="Available as an emergency vendor"
            description="Get pinged when a creator needs a last-minute replacement. Higher rate, faster pay."
            icon={<Zap className="h-4 w-4" />}
          />

          {form.emergencyAvailable && (
            <NestedReveal>
              <Field label="Emergency-rate uplift (%)" error={stepErrors.emergencyRate}>
                <Input type="number" value={form.emergencyRate} onChange={(e) => setForm({ ...form, emergencyRate: e.target.value })} placeholder="50" />
              </Field>
            </NestedReveal>
          )}

          <LegalAgreementCheckbox
            checked={form.termsAccepted}
            onChange={(termsAccepted) => setForm({ ...form, termsAccepted })}
            error={stepErrors.termsAccepted}
          />
        </div>
      )}

      <div className="mt-10 space-y-4">
        <InlineFormError message={inlineError} />
        <div className="flex items-center justify-between">
          <Button variant="glass" onClick={back}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < total ? (
            <Button variant="hero" onClick={next} disabled={!isCurrentStepValid}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="hero" onClick={finish} disabled={isLoading || !isCurrentStepValid}>
              <Music2 className="h-4 w-4" />
              {isLoading ? 'Publishing...' : 'Publish my vendor profile'}
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function SignupExperience({
  initialUserType = null,
  alreadySignedInWarning = false,
  opportunityToken = null,
}: {
  initialUserType?: UserType | null
  alreadySignedInWarning?: boolean
  opportunityToken?: string | null
}) {
  const router = useRouter()
  const [role, setRole] = useState<UserType | null>(initialUserType)

  const handleBack = () => {
    if (initialUserType) {
      router.push('/signup')
      return
    }
    setRole(null)
  }

  if (!role) return <RoleSelector alreadySignedInWarning={alreadySignedInWarning} />
  if (role === 'community_builder') {
    return <BuilderSignupFlow onBack={handleBack} alreadySignedInWarning={alreadySignedInWarning} />
  }
  if (role === 'venue_owner') {
    return (
      <VenueSignupFlow
        onBack={handleBack}
        alreadySignedInWarning={alreadySignedInWarning}
        opportunityToken={opportunityToken}
      />
    )
  }
  if (role === 'vendor') return <VendorSignupFlow onBack={handleBack} alreadySignedInWarning={alreadySignedInWarning} />
  return null
}
