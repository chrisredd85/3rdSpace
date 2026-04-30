'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Ticket,
  Building2,
  Music2,
  Sparkles,
  Camera,
  Zap,
  Users,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { TicketingSetupGuide } from '@/components/auth/TicketingSetupGuide'
import type { UserType } from '@/lib/types'

// ─── Shared primitives ───────────────────────────────────────────────────────

function AuthShell({
  eyebrow,
  title,
  subtitle,
  accent = 'primary',
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  accent?: 'primary' | 'secondary' | 'accent'
  children: React.ReactNode
}) {
  const glowMap = {
    primary: 'from-primary to-primary-glow',
    secondary: 'from-secondary to-primary',
    accent: 'from-accent to-secondary',
  }
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-mesh opacity-60" />
      <div
        className={`absolute -left-32 top-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br ${glowMap[accent]} opacity-20 blur-3xl`}
      />
      <div
        className={`absolute -right-32 bottom-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br ${glowMap[accent]} opacity-20 blur-3xl`}
      />

      <header className="relative flex items-center justify-between px-6 py-5 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">3rdSpace</span>
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-smooth hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </header>

      <main className="relative mx-auto w-full max-w-2xl px-6 pb-20 pt-6 lg:pt-12">
        <div className="rounded-3xl border border-border bg-card/70 p-8 shadow-card backdrop-blur-xl md:p-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-secondary">{eyebrow}</p>
          <h1 className="mt-2 font-display text-3xl font-bold md:text-4xl">{title}</h1>
          {subtitle && <p className="mt-3 text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  )
}

function Stepper({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8 flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-smooth ${
            i + 1 <= step ? 'bg-gradient-brand' : 'bg-border'
          }`}
        />
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
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
                ? 'border-primary bg-primary/15 text-foreground'
                : 'border-border bg-card/40 text-muted-foreground hover:border-primary/40'
            }`}
          >
            {active && <Check className="h-3.5 w-3.5 text-primary" />}
            {o}
          </button>
        )
      })}
    </div>
  )
}

// ─── Role selector ────────────────────────────────────────────────────────────

function RoleSelector({ onSelect }: { onSelect: (role: UserType) => void }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-mesh opacity-60" />
      <div className="absolute -left-32 top-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-primary to-primary-glow opacity-20 blur-3xl" />
      <div className="absolute -right-32 bottom-0 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-secondary to-primary opacity-20 blur-3xl" />

      <header className="relative flex items-center justify-between px-6 py-5 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">3rdSpace</span>
        </Link>
      </header>

      <main className="relative mx-auto w-full max-w-4xl px-6 pb-20 pt-10">
        <div className="mb-10 text-center">
          <h1 className="font-display text-4xl font-bold md:text-5xl">Join 3rdSpace</h1>
          <p className="mt-3 text-lg text-muted-foreground">Choose your account type to get started</p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              type: 'community_builder' as UserType,
              icon: <Users className="h-8 w-8" />,
              label: 'Community Builder',
              description: 'Create events, book venues and vendors, track finances all in one place.',
              accent: 'border-primary/40 hover:border-primary',
            },
            {
              type: 'venue_owner' as UserType,
              icon: <Building2 className="h-8 w-8" />,
              label: 'Venue Owner',
              description: 'List your space, set your rates, and let creators find and book you.',
              accent: 'border-secondary/40 hover:border-secondary',
            },
            {
              type: 'vendor' as UserType,
              icon: <Store className="h-8 w-8" />,
              label: 'Vendor',
              description: 'Offer your services, set packages, and get booked by event creators.',
              accent: 'border-accent/40 hover:border-accent',
            },
          ].map((item) => (
            <button
              key={item.type}
              onClick={() => onSelect(item.type)}
              className={`group rounded-3xl border bg-gradient-card p-7 text-left shadow-card transition-smooth hover:-translate-y-1 hover:shadow-glow ${item.accent}`}
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand text-primary-foreground shadow-glow">
                {item.icon}
              </div>
              <h2 className="font-display text-xl font-bold">{item.label}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
              <div className="mt-5 flex items-center gap-1 text-sm font-semibold text-primary">
                Get started <ArrowRight className="h-4 w-4 transition-smooth group-hover:translate-x-1" />
              </div>
            </button>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </main>
    </div>
  )
}

// ─── Builder / Creator signup ─────────────────────────────────────────────────

const creatorEventTypes = ['Day party', 'Nightlife', 'Concert', 'Conference', 'Pop-up', 'Wedding', 'Corporate', 'Brunch']
const creatorAmenities = ['Stage / DJ booth', 'Outdoor space', 'Full bar', 'Kitchen access', 'Green room', 'AV included', 'Coat check', 'Parking', 'ADA access']
const ticketPlatforms = ['Eventbrite', 'Posh', 'Luma']
const orgTypes = ['Promoter / Production company', 'Social group / Community', 'Brand / Agency', 'Nonprofit', 'Independent creator']

const ticketPlatformIds: Record<string, 'eventbrite' | 'posh' | 'luma'> = {
  Eventbrite: 'eventbrite',
  Posh: 'posh',
  Luma: 'luma',
}

function BuilderSignupFlow({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 4
  const [isLoading, setIsLoading] = useState(false)

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
  })

  const toggle = (key: 'eventTypes' | 'amenities' | 'platforms', value: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }))
  }

  const next = () => setStep((s) => Math.min(total, s + 1))
  const back = () => (step > 1 ? setStep((s) => s - 1) : onBack())

  const finish = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userType: 'community_builder',
          email: form.email,
          password: form.password,
          name: form.fullName,
          organization_name: form.orgName,
          org_type: form.orgType,
          social_handle: form.socialHandle,
          website: form.website,
          bio: form.bio,
          event_types: form.eventTypes,
          avg_attendance: form.avgAttendance,
          preferred_amenities: form.amenities,
          ticket_platforms: form.platforms.map((platform) => ticketPlatformIds[platform]).filter(Boolean),
          bulk_booking_enabled: form.bulkBooking,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        addToast({ title: 'Sign up failed', description: result.error || 'Failed to create account', variant: 'destructive' })
        setIsLoading(false)
        return
      }
      if (result.requiresEmailConfirmation) {
        addToast({ title: 'Check your email', description: 'Confirm your email address, then log in.' })
        router.push('/login')
        return
      }

      if (form.platforms.includes('Eventbrite')) {
        try {
          const connectResponse = await fetch('/api/integrations/eventbrite/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({}),
          })
          const connectResult = await connectResponse.json().catch(() => null)

          if (connectResponse.ok && connectResult?.authUrl) {
            addToast({ title: 'Account created', description: 'Connect your Eventbrite account to finish setup.' })
            window.location.href = connectResult.authUrl
            return
          }
        } catch (connectError) {
          console.error('Eventbrite connection could not start after signup:', connectError)
        }
      }

      addToast({ title: 'Welcome to 3rdSpace!', description: 'Your creator account is ready.' })
      router.push('/builder')
    } catch {
      addToast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' })
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Creator sign-up · Step ${step} of ${total}`}
      title="Set up your Creator account"
      subtitle="Tell us about your organization and the events you throw so we can match you to the right venues and vendors."
      accent="primary"
    >
      <Stepper step={step} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Alex Rivera" />
            </Field>
            <Field label="Work email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="alex@brand.com" />
            </Field>
          </div>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization / brand / collective">
              <Input value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} placeholder="Sunset Social Club" />
            </Field>
            <Field label="Type of organization">
              <select
                value={form.orgType}
                onChange={(e) => setForm({ ...form, orgType: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
          <Field label="Short bio">
            <Textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} placeholder="What's your scene? Who do you throw events for?" />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">What types of events do you host?</Label>
            <ChipGroup options={creatorEventTypes} selected={form.eventTypes} onToggle={(v) => toggle('eventTypes', v)} />
          </div>
          <Field label="Average attendance per event">
            <Input value={form.avgAttendance} onChange={(e) => setForm({ ...form, avgAttendance: e.target.value })} placeholder="e.g. 150" />
          </Field>
          <div>
            <Label className="mb-2 block">Amenities that matter most when picking a space</Label>
            <ChipGroup options={creatorAmenities} selected={form.amenities} onToggle={(v) => toggle('amenities', v)} />
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">Connect your ticketing platforms</Label>
            <p className="mb-3 text-xs text-muted-foreground">We&apos;ll auto-import sales totals and attendee counts.</p>
            <ChipGroup options={ticketPlatforms} selected={form.platforms} onToggle={(v) => toggle('platforms', v)} />
          </div>

          <TicketingSetupGuide selectedPlatforms={form.platforms} />

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card/40 p-4 hover:border-primary/40 transition-smooth">
            <input
              type="checkbox"
              checked={form.bulkBooking}
              onChange={(e) => setForm({ ...form, bulkBooking: e.target.checked })}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <div>
              <p className="font-medium">Enable bulk booking & event templates</p>
              <p className="text-xs text-muted-foreground">Run a recurring series? Save a template, clone it, book the whole season at once.</p>
            </div>
          </label>

          <Field label="Invite collaborators (comma-separated emails, optional)">
            <Textarea
              rows={2}
              value={form.inviteCollaborators}
              onChange={(e) => setForm({ ...form, inviteCollaborators: e.target.value })}
              placeholder="co-host@brand.com, manager@brand.com"
            />
          </Field>
        </div>
      )}

      <div className="mt-10 flex items-center justify-between">
        <Button variant="glass" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < total ? (
          <Button variant="hero" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="hero" onClick={finish} disabled={isLoading}>
            <Ticket className="h-4 w-4" />
            {isLoading ? 'Creating account...' : 'Create my Creator account'}
          </Button>
        )}
      </div>
    </AuthShell>
  )
}

// ─── Venue signup ─────────────────────────────────────────────────────────────

const venueTypes = ['Bar', 'Club / Nightlife', 'Restaurant', 'Loft / Studio', 'Rooftop', 'Warehouse', 'Gallery', 'Outdoor']
const venueAmenities = ['DJ booth', 'Stage', 'PA / sound system', 'Lighting rig', 'Full bar', 'Kitchen', 'Green room', 'Coat check', 'Parking', 'Loading dock', 'ADA access', 'Wifi']
const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function VenueSignupFlow({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 5
  const [isLoading, setIsLoading] = useState(false)

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
    state: '',
    zipCode: '',
    loadingAddress: '',
    capacity: '',
    prepTime: '2',
    amenities: [] as string[],
    houseRules: '',
    isBar: false,
    barKickback: '10',
    perHeadDrinkPct: '15',
    minBarSpend: '',
    pricePerNight: '',
    deposit: '',
    cancellationTerms: '',
    openDays: [] as string[],
    openFrom: '18:00',
    openTo: '02:00',
  })

  const toggle = (key: 'amenities' | 'openDays', v: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))
  }

  const next = () => setStep((s) => Math.min(total, s + 1))
  const back = () => (step > 1 ? setStep((s) => s - 1) : onBack())

  const finish = async () => {
    setIsLoading(true)
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
          venue_type: form.venueType.toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_'),
          address: form.address,
          city: form.city || addressParts[1] || '',
          state: form.state || addressParts[2] || '',
          zip_code: form.zipCode || '',
          loading_address: form.loadingAddress,
          capacity: parseInt(form.capacity) || 0,
          prep_time: parseInt(form.prepTime) || 2,
          amenities: form.amenities,
          house_rules: form.houseRules,
          has_bar: form.isBar,
          bar_kickback_pct: form.isBar ? parseFloat(form.barKickback) : null,
          per_head_drink_pct: form.isBar ? parseFloat(form.perHeadDrinkPct) : null,
          min_bar_spend: form.isBar ? parseFloat(form.minBarSpend) : null,
          price_per_night: parseFloat(form.pricePerNight) || 0,
          deposit: parseFloat(form.deposit) || 0,
          cancellation_terms: form.cancellationTerms,
          available_days: form.openDays,
          open_from: form.openFrom,
          open_to: form.openTo,
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        addToast({ title: 'Sign up failed', description: result.error || 'Failed to create account', variant: 'destructive' })
        setIsLoading(false)
        return
      }
      if (result.requiresEmailConfirmation) {
        addToast({ title: 'Check your email', description: 'Confirm your email address, then log in.' })
        router.push('/login')
        return
      }
      addToast({ title: 'Welcome to 3rdSpace!', description: 'Your venue listing is live.' })
      router.push('/venue')
    } catch {
      addToast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' })
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Venue sign-up · Step ${step} of ${total}`}
      title="List your venue on 3rdSpace"
      subtitle="Show creators what makes your space special. Set your rules, your rates, and your calendar — once."
      accent="secondary"
    >
      <Stepper step={step} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Point-of-contact name">
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Jordan Lee" />
            </Field>
            <Field label="Their role">
              <Input value={form.contactRole} onChange={(e) => setForm({ ...form, contactRole: e.target.value })} placeholder="GM / Owner / Booker" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Booking email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="bookings@venue.com" />
            </Field>
            <Field label="Booking phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 555-5555" />
            </Field>
          </div>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue name">
              <Input value={form.venueName} onChange={(e) => setForm({ ...form, venueName: e.target.value })} placeholder="The Foundry Loft" />
            </Field>
            <Field label="Venue type">
              <select
                value={form.venueType}
                onChange={(e) => setForm({ ...form, venueType: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select...</option>
                {venueTypes.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Main entrance address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Industry Rd, Brooklyn NY" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Brooklyn" />
            </Field>
            <Field label="State">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="NY" maxLength={2} />
            </Field>
            <Field label="ZIP">
              <Input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} placeholder="11201" />
            </Field>
          </div>
          <Field label="Loading dock address (if different)">
            <Input value={form.loadingAddress} onChange={(e) => setForm({ ...form, loadingAddress: e.target.value })} placeholder="Rear entrance — 124 Industry Rd" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Maximum capacity">
              <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="250" />
            </Field>
            <Field label="Prep / load-in time allowed (hours)">
              <Input type="number" value={form.prepTime} onChange={(e) => setForm({ ...form, prepTime: e.target.value })} placeholder="2" />
            </Field>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">Amenities & equipment</Label>
            <ChipGroup options={venueAmenities} selected={form.amenities} onToggle={(v) => toggle('amenities', v)} />
          </div>
          <div>
            <Label className="mb-2 block">Photos of the space</Label>
            <div className="flex h-32 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/40 text-sm text-muted-foreground transition-smooth hover:border-primary/40">
              <div className="flex flex-col items-center gap-2">
                <Camera className="h-6 w-6" />
                <span>Drop photos here or click to upload</span>
                <span className="text-xs">Interior, exterior, stage, bar, loading area</span>
              </div>
            </div>
          </div>
          <Field label="House rules">
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
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card/40 p-4 hover:border-primary/40 transition-smooth">
            <input
              type="checkbox"
              checked={form.isBar}
              onChange={(e) => setForm({ ...form, isBar: e.target.checked })}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <div>
              <p className="font-medium">This venue serves alcohol / has a bar</p>
              <p className="text-xs text-muted-foreground">Unlocks kickback & per-head drink revenue settings below.</p>
            </div>
          </label>

          {form.isBar && (
            <div className="grid gap-4 rounded-2xl border border-secondary/30 bg-secondary/5 p-5 sm:grid-cols-3">
              <Field label="Bar kickback to creator (%)">
                <Input type="number" value={form.barKickback} onChange={(e) => setForm({ ...form, barKickback: e.target.value })} placeholder="10" />
              </Field>
              <Field label="Per-head drink sales (%)">
                <Input type="number" value={form.perHeadDrinkPct} onChange={(e) => setForm({ ...form, perHeadDrinkPct: e.target.value })} placeholder="15" />
              </Field>
              <Field label="Minimum bar spend ($)">
                <Input type="number" value={form.minBarSpend} onChange={(e) => setForm({ ...form, minBarSpend: e.target.value })} placeholder="2000" />
              </Field>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Base price per night ($)">
              <Input type="number" value={form.pricePerNight} onChange={(e) => setForm({ ...form, pricePerNight: e.target.value })} placeholder="3500" />
            </Field>
            <Field label="Deposit required ($)">
              <Input type="number" value={form.deposit} onChange={(e) => setForm({ ...form, deposit: e.target.value })} placeholder="1500" />
            </Field>
          </div>
          <Field label="Cancellation terms">
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
            <Label className="mb-2 block">Available booking days</Label>
            <ChipGroup options={weekDays} selected={form.openDays} onToggle={(v) => toggle('openDays', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Earliest start time">
              <Input type="time" value={form.openFrom} onChange={(e) => setForm({ ...form, openFrom: e.target.value })} />
            </Field>
            <Field label="Latest end time">
              <Input type="time" value={form.openTo} onChange={(e) => setForm({ ...form, openTo: e.target.value })} />
            </Field>
          </div>
          <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 text-sm">
            <p className="font-medium">Calendar sync</p>
            <p className="mt-1 text-muted-foreground">After signup, connect Google Calendar or import an .ics feed to prevent double-bookings automatically.</p>
          </div>
        </div>
      )}

      <div className="mt-10 flex items-center justify-between">
        <Button variant="glass" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < total ? (
          <Button variant="hero" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="hero" onClick={finish} disabled={isLoading}>
            <Building2 className="h-4 w-4" />
            {isLoading ? 'Publishing...' : 'Publish my venue listing'}
          </Button>
        )}
      </div>
    </AuthShell>
  )
}

// ─── Vendor signup ────────────────────────────────────────────────────────────

const vendorServices = ['DJ', 'Live band', 'Photographer', 'Videographer', 'Catering', 'Bartending', 'AV / Production', 'Lighting', 'Florals', 'Security', 'Hosts / Staffing', 'Decor']

function VendorSignupFlow({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState(1)
  const total = 4
  const [isLoading, setIsLoading] = useState(false)

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
  })

  const toggle = (key: 'services' | 'availableDays', v: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }))
  }

  const next = () => setStep((s) => Math.min(total, s + 1))
  const back = () => (step > 1 ? setStep((s) => s - 1) : onBack())

  const finish = async () => {
    setIsLoading(true)
    try {
      const serviceType = form.services[0]?.toLowerCase().replace(/ \/ /g, '_').replace(/ /g, '_') || 'other'
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
          bank_account_holder_name: form.fullName,
          bank_name: '',
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        addToast({ title: 'Sign up failed', description: result.error || 'Failed to create account', variant: 'destructive' })
        setIsLoading(false)
        return
      }
      if (result.requiresEmailConfirmation) {
        addToast({ title: 'Check your email', description: 'Confirm your email address, then log in.' })
        router.push('/login')
        return
      }
      addToast({ title: 'Welcome to 3rdSpace!', description: 'Your vendor profile is live.' })
      router.push('/vendor')
    } catch {
      addToast({ title: 'Error', description: 'An unexpected error occurred.', variant: 'destructive' })
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      eyebrow={`Vendor sign-up · Step ${step} of ${total}`}
      title="Get booked on 3rdSpace"
      subtitle="List your services, set your rates, and choose whether you're available for last-minute emergency gigs."
      accent="accent"
    >
      <Stepper step={step} total={total} />

      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Sam Carter" />
            </Field>
            <Field label="Business / stage name">
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="DJ Solstice" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="hello@vendor.com" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (555) 555-5555" />
            </Field>
          </div>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">What services do you provide?</Label>
            <ChipGroup options={vendorServices} selected={form.services} onToggle={(v) => toggle('services', v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Service area">
              <Input value={form.serviceArea} onChange={(e) => setForm({ ...form, serviceArea: e.target.value })} placeholder="NYC + tri-state, will travel" />
            </Field>
            <Field label="Portfolio / IG link">
              <Input value={form.portfolioUrl} onChange={(e) => setForm({ ...form, portfolioUrl: e.target.value })} placeholder="https://instagram.com/..." />
            </Field>
          </div>
          <Field label="Short bio">
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
          <Field label="Base / starting price ($)">
            <Input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} placeholder="800" />
          </Field>
          <div className="rounded-2xl border border-border bg-card/40 p-5">
            <p className="mb-4 font-display text-sm font-semibold">Add a starter package</p>
            <Field label="Package name">
              <Input value={form.packageName} onChange={(e) => setForm({ ...form, packageName: e.target.value })} placeholder="4-hour open format set" />
            </Field>
            <div className="mt-4">
              <Field label="What's included">
                <Textarea
                  rows={3}
                  value={form.packageDetails}
                  onChange={(e) => setForm({ ...form, packageDetails: e.target.value })}
                  placeholder="4 hours of music, basic lighting, custom playlist consult..."
                />
              </Field>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deposit required (%)">
              <Input type="number" value={form.depositPct} onChange={(e) => setForm({ ...form, depositPct: e.target.value })} placeholder="30" />
            </Field>
            <Field label="Minimum lead time (days)">
              <Input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} placeholder="7" />
            </Field>
          </div>
          <Field label="Cancellation terms">
            <Textarea
              rows={2}
              value={form.cancellationTerms}
              onChange={(e) => setForm({ ...form, cancellationTerms: e.target.value })}
              placeholder="Deposit non-refundable inside 14 days. Full refund 30+ days out."
            />
          </Field>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <Label className="mb-2 block">Days you&apos;re typically available</Label>
            <ChipGroup options={weekDays} selected={form.availableDays} onToggle={(v) => toggle('availableDays', v)} />
            <p className="mt-2 text-xs text-muted-foreground">After signup, set specific blocked dates on your calendar.</p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-accent/40 bg-accent/5 p-5 hover:border-accent transition-smooth">
            <input
              type="checkbox"
              checked={form.emergencyAvailable}
              onChange={(e) => setForm({ ...form, emergencyAvailable: e.target.checked })}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent" />
                <p className="font-medium">Available as an emergency vendor</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Get pinged when a creator needs a last-minute replacement. Higher rate, faster pay.</p>
            </div>
          </label>

          {form.emergencyAvailable && (
            <Field label="Emergency-rate uplift (%)">
              <Input type="number" value={form.emergencyRate} onChange={(e) => setForm({ ...form, emergencyRate: e.target.value })} placeholder="50" />
            </Field>
          )}
        </div>
      )}

      <div className="mt-10 flex items-center justify-between">
        <Button variant="glass" onClick={back}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        {step < total ? (
          <Button variant="hero" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="hero" onClick={finish} disabled={isLoading}>
            <Music2 className="h-4 w-4" />
            {isLoading ? 'Publishing...' : 'Publish my vendor profile'}
          </Button>
        )}
      </div>
    </AuthShell>
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function SignupExperience({ initialUserType = null }: { initialUserType?: UserType | null }) {
  const [role, setRole] = useState<UserType | null>(initialUserType)

  const handleBack = () => setRole(null)

  if (!role) return <RoleSelector onSelect={setRole} />
  if (role === 'community_builder') return <BuilderSignupFlow onBack={handleBack} />
  if (role === 'venue_owner') return <VenueSignupFlow onBack={handleBack} />
  if (role === 'vendor') return <VendorSignupFlow onBack={handleBack} />
  return null
}
