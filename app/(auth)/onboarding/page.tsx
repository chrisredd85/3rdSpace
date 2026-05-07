'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowRight, Building2, Store, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useUser } from '@/lib/hooks/useUser'
import { TicketingSetupGuide } from '@/components/auth/TicketingSetupGuide'
import {
  BUILDER_EVENT_TYPE_OPTIONS,
  TICKET_PLATFORM_OPTIONS,
  VENUE_AMENITIES,
  VENUE_AMENITY_CATEGORY_LABELS,
} from '@/lib/constants/account-setup'
import {
  builderSignupSchema,
  venueSignupSchema,
  vendorSignupSchema,
  type BuilderSignupInput,
  type VenueSignupInput,
  type VendorSignupInput,
} from '@/lib/validations/auth'

function groupedVenueAmenities() {
  return VENUE_AMENITIES.reduce<Record<string, Array<(typeof VENUE_AMENITIES)[number]>>>((groups, amenity) => {
    if (!groups[amenity.category]) groups[amenity.category] = []
    groups[amenity.category].push(amenity)
    return groups
  }, {})
}

function CheckboxGroup({
  name,
  register,
  options,
  selectedValues = [],
}: {
  name: string
  register: any
  options: Array<{ id: string; label: string }>
  selectedValues?: string[]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <label
          key={option.id}
          className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm ${
            selectedValues.includes(option.id)
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card/40 text-foreground'
          }`}
        >
          <input type="checkbox" value={option.id} className="h-4 w-4" {...register(name)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const { user, isLoading } = useUser()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login')
      return
    }

    if (!user) return

    fetch('/api/onboarding/check')
      .then((response) => response.json())
      .then((result) => {
        if (result.isOnboarded && result.redirectPath) {
          router.push(result.redirectPath)
        }
      })
      .catch(() => {})
  }, [isLoading, router, user])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (user.userType === 'venue_owner') {
    return <VenueOnboardingForm />
  }

  if (user.userType === 'vendor') {
    return <VendorOnboardingForm />
  }

  return <BuilderOnboardingForm />
}

function BuilderOnboardingForm() {
  const router = useRouter()
  const { addToast } = useToast()
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<BuilderSignupInput>({
    resolver: zodResolver(builderSignupSchema.omit({ email: true, password: true })),
  } as any)
  const selectedEventTypes = watch('event_types') || []
  const selectedPlatforms = watch('ticket_platforms') || []

  const onSubmit = async (data: any) => {
    const response = await fetch('/api/onboarding/builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await response.json()
    if (!response.ok || !result.success) {
      addToast({ title: 'Setup failed', description: result.error || 'Please try again.', variant: 'destructive' })
      return
    }
    addToast({ title: 'Builder profile saved', description: 'You can start creating events now.' })
    router.push('/planner')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Finish Builder Setup</CardTitle>
          <CardDescription>We need your organization and ticketing setup before opening the event workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <Field label="Point of Contact" error={errors.name?.message}>
              <Input placeholder="Jordan Lee" {...register('name')} />
            </Field>
            <Field label="Organization Name" error={errors.organization_name?.message}>
              <Input placeholder="Neighborhood Social Club" {...register('organization_name')} />
            </Field>
            <Field label="Types of Events You Host" error={errors.event_types?.message as string | undefined}>
              <CheckboxGroup
                name="event_types"
                register={register}
                options={BUILDER_EVENT_TYPE_OPTIONS.map((eventType) => ({ id: eventType, label: eventType }))}
                selectedValues={selectedEventTypes}
              />
            </Field>
            <Field label="Ticket Platforms" error={errors.ticket_platforms?.message as string | undefined}>
              <CheckboxGroup
                name="ticket_platforms"
                register={register}
                options={TICKET_PLATFORM_OPTIONS}
                selectedValues={selectedPlatforms}
              />
            </Field>
            <TicketingSetupGuide selectedPlatforms={selectedPlatforms} persistConnections />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function VenueOnboardingForm() {
  const router = useRouter()
  const { addToast } = useToast()
  const amenityGroups = groupedVenueAmenities()
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<VenueSignupInput>({
    resolver: zodResolver(venueSignupSchema.omit({ email: true, password: true })),
  } as any)
  const selectedAmenities = watch('amenities') || []

  const onSubmit = async (data: any) => {
    const response = await fetch('/api/onboarding/venue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await response.json()
    if (!response.ok || !result.success) {
      addToast({ title: 'Setup failed', description: result.error || 'Please try again.', variant: 'destructive' })
      return
    }
    addToast({ title: 'Venue saved', description: 'Your venue profile is ready.' })
    router.push('/venue')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-4xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Finish Venue Setup</CardTitle>
          <CardDescription>Add your venue details, rules, and amenities before you get access.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Your Name" error={errors.contact_name?.message}>
                <Input {...register('contact_name')} />
              </Field>
              <Field label="Venue Name" error={errors.venue_name?.message}>
                <Input {...register('venue_name')} />
              </Field>
            </div>
            <Field label="Street Address" error={errors.address?.message}>
              <Input {...register('address')} />
            </Field>
            <div className="grid gap-4 md:grid-cols-4">
              <Field label="City" error={errors.city?.message}><Input {...register('city')} /></Field>
              <Field label="State" error={errors.state?.message}><Input maxLength={2} {...register('state')} /></Field>
              <Field label="ZIP Code" error={errors.zip_code?.message}><Input {...register('zip_code')} /></Field>
              <Field label="Capacity" error={errors.capacity?.message}><Input type="number" {...register('capacity', { valueAsNumber: true })} /></Field>
            </div>
            <Field label="Venue Type" error={errors.venue_type?.message}>
              <select className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" {...register('venue_type')}>
                <option value="">Select venue type</option>
                <option value="loft_warehouse">Loft/Warehouse</option>
                <option value="gallery">Gallery</option>
                <option value="restaurant">Restaurant</option>
                <option value="rooftop">Rooftop</option>
                <option value="conference_center">Conference Center</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="House Rules / Requirements" error={errors.house_rules?.message}>
              <textarea rows={4} className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm" {...register('house_rules')} />
            </Field>
            <Field label="Amenities" error={errors.amenities?.message as string | undefined}>
              <div className="space-y-4">
                {Object.entries(amenityGroups).map(([category, amenities]) => (
                  <div key={category} className="space-y-2">
                    <p className="text-sm font-medium text-foreground">{VENUE_AMENITY_CATEGORY_LABELS[category]}</p>
                    <CheckboxGroup
                      name="amenities"
                      register={register}
                      options={amenities.map((amenity) => ({ id: amenity.id, label: amenity.label }))}
                      selectedValues={selectedAmenities}
                    />
                  </div>
                ))}
              </div>
            </Field>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function VendorOnboardingForm() {
  const router = useRouter()
  const { addToast } = useToast()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<VendorSignupInput>({
    resolver: zodResolver(vendorSignupSchema.omit({ email: true, password: true })),
  } as any)

  const onSubmit = async (data: any) => {
    const response = await fetch('/api/onboarding/vendor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await response.json()
    if (!response.ok || !result.success) {
      addToast({ title: 'Setup failed', description: result.error || 'Please try again.', variant: 'destructive' })
      return
    }
    addToast({ title: 'Vendor profile saved', description: 'You can start reviewing booking requests now.' })
    router.push('/vendor')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-3xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Finish Vendor Setup</CardTitle>
          <CardDescription>Add your service, payout profile basics, and availability before you enter the vendor workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <Field label="Name" error={errors.name?.message}>
              <Input {...register('name')} />
            </Field>
            <Field label="Service Type" error={errors.service_type?.message}>
              <select className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" {...register('service_type')}>
                <option value="">Select service type</option>
                <option value="dj">DJ</option>
                <option value="catering">Catering</option>
                <option value="bartending">Bartending</option>
                <option value="photography">Photography</option>
                <option value="videography">Videography</option>
                <option value="av_tech">AV/Tech</option>
                <option value="event_planning">Event Planning</option>
                <option value="florist">Florist</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Bank Account Holder Name" error={errors.bank_account_holder_name?.message}>
                <Input {...register('bank_account_holder_name')} />
              </Field>
              <Field label="Bank Name" error={errors.bank_name?.message}>
                <Input {...register('bank_name')} />
              </Field>
            </div>
            <Field label="Availability" error={errors.availability_notes?.message}>
              <textarea rows={4} className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm" {...register('availability_notes')} />
            </Field>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : <>Continue <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
