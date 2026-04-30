'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Calendar, ChevronRight, Info, Menu, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEvent, useUpdateEvent } from '@/lib/hooks/useEvents'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { EventPlanningStep } from '@/components/builder/event-wizard/EventPlanningStep'
import { EventTeamStep } from '@/components/builder/event-wizard/EventTeamStep'
import { EventVenueStep } from '@/components/builder/event-wizard/EventVenueStep'
import { EventVendorStep } from '@/components/builder/event-wizard/EventVendorStep'
import { EventChecklistStep } from '@/components/builder/event-wizard/EventChecklistStep'
import { EventDocumentsStep } from '@/components/builder/event-wizard/EventDocumentsStep'
import { EventFinalizeStep } from '@/components/builder/event-wizard/EventFinalizeStep'
import { cn } from '@/lib/utils'
import type { Event, VendorBooking } from '@/lib/types'

const STEPS = [
  { id: 1, name: 'Planning', description: 'Event details' },
  { id: 2, name: 'Team', description: 'Invite collaborators' },
  { id: 3, name: 'Venue', description: 'Find your space' },
  { id: 4, name: 'Vendors', description: 'Book services' },
  { id: 5, name: 'Checklist', description: 'Task tracking' },
  { id: 6, name: 'Documents', description: 'Contracts & permits' },
  { id: 7, name: 'Finalize', description: 'Review & confirm' },
]

type VendorBookingWithProfile = VendorBooking & {
  vendor_profiles?: {
    name: string | null
  } | null
}

export default function EventWizardPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const eventId = params.eventId as string
  const [currentStep, setCurrentStep] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [vendorBookings, setVendorBookings] = useState<VendorBookingWithProfile[]>([])

  const userId = user?.id || null
  const isNew = eventId === 'new'

  const { data: event, isLoading: isEventLoading } = useEvent(isNew ? null : eventId)
  const updateEvent = useUpdateEvent()

  useEffect(() => {
    const stepParam = searchParams.get('step') || searchParams.get('view')
    if (!stepParam) return

    const requestedStep = stepParam === 'finalize' ? 7 : Number(stepParam)
    if (!Number.isFinite(requestedStep)) return

    const nextStep = Math.min(Math.max(requestedStep, 1), STEPS.length)
    setCurrentStep((current) => (current === nextStep ? current : nextStep))
  }, [searchParams])

  useEffect(() => {
    if (isNew && userId && !event) {
      fetch('/api/builder/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: 'New Event',
          event_date: new Date().toISOString().slice(0, 10),
          status: 'planning',
        }),
      })
        .then(async (res) => {
          const result = await res.json()
          if (!res.ok) throw new Error(result.error || 'Failed to create event')
          return result
        })
        .then((result: { event?: { id: string } }) => {
          if (result.event?.id) router.replace(`/builder/event/${result.event.id}`)
        })
        .catch(console.error)
    }
  }, [isNew, userId, event, router])

  useEffect(() => {
    if (!event) return
    const completed = new Set<number>()
    if ((event.title || (event as { name?: string }).name) && event.event_date && event.budget) completed.add(1)
    completed.add(2)
    if (event.venue_id) completed.add(3)
    if (vendorBookings.length > 0) completed.add(4)
    completed.add(5)
    completed.add(6)
    if (completed.size >= 6) completed.add(7)
    setCompletedSteps(completed)
  }, [event, vendorBookings.length])

  useEffect(() => {
    if (!event?.id) return
    supabase.from('vendor_bookings').select('*, vendor_profiles(*)').eq('event_id', event.id)
      .then(({ data }: { data: unknown }) => {
        setVendorBookings(Array.isArray(data) ? data as VendorBookingWithProfile[] : [])
      })
      .catch(() => {})
  }, [event?.id])

  if (isUserLoading || isEventLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <Sparkles className="h-7 w-7 animate-pulse text-primary-foreground" />
          </div>
          <p className="font-display text-lg font-semibold text-foreground">Loading event...</p>
        </div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="mb-2 text-xl font-semibold text-destructive">Authentication Error</p>
          <p className="mb-4 text-muted-foreground">Please log in to continue</p>
          <Button variant="hero" onClick={() => router.push('/login')}>Go to Login</Button>
        </div>
      </div>
    )
  }

  if (!event && !isNew) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="mb-2 text-xl font-semibold text-foreground">Event not found</p>
          <Button variant="glass" onClick={() => router.push('/builder')} className="mt-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  const currentEvent: Event = event
    ? { ...event, title: event.title ?? (event as { name?: string }).name ?? 'New Event' }
    : {
        id: 'new',
        builder_id: userId || '',
        title: 'New Event',
        event_type: null,
        event_date: new Date().toISOString().slice(0, 10),
        start_time: null,
        end_time: null,
        expected_attendees: null,
        status: 'planning',
        description: null,
        venue_id: null,
        budget: null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

  const handleNext = () => { if (currentStep < STEPS.length) { setCurrentStep(currentStep + 1); setSidebarOpen(false) } }
  const handlePrevious = () => { if (currentStep > 1) { setCurrentStep(currentStep - 1); setSidebarOpen(false) } }
  const handleSaveDraft = async () => {
    if (!event?.id) return
    try {
      await updateEvent.mutateAsync({ id: event.id, updates: { status: 'planning', updated_at: new Date().toISOString() } })
    } catch (error) { console.error('Error saving draft:', error) }
  }

  const ensureEventReady = async (planningData?: {
    name?: string; event_type?: string; expected_attendees?: number; event_date?: string; event_time?: string; budget?: number
  }) => {
    if (!isNew && event?.id) return event.id
    const title = planningData?.name?.trim() || 'New Event'
    const eventDate = planningData?.event_date || new Date().toISOString().slice(0, 10)
    const eventTime = planningData?.event_time || '18:00'
    try {
      const response = await fetch('/api/builder/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title, event_type: planningData?.event_type || null, expected_attendees: planningData?.expected_attendees || null, event_date: eventDate, start_time: eventTime, end_time: eventTime, budget: planningData?.budget || 0, status: 'planning' }),
      })
      const result = await response.json()
      if (!response.ok || !result.event?.id) throw new Error(result.error || 'Failed to create event')
      router.replace(`/builder/event/${result.event.id}`)
      return result.event.id as string
    } catch (error) { console.error('Error ensuring event exists:', error); return null }
  }

  const getStepComponent = () => {
    switch (currentStep) {
      case 1: return EventPlanningStep
      case 2: return EventTeamStep
      case 3: return EventVenueStep
      case 4: return EventVendorStep
      case 5: return EventChecklistStep
      case 6: return EventDocumentsStep
      case 7: return EventFinalizeStep
      default: return EventPlanningStep
    }
  }

  const CurrentStepComponent = getStepComponent()

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile menu button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed left-4 top-4 z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card/80 shadow-card backdrop-blur-sm transition-smooth hover:bg-card lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Close (mobile only) */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-smooth hover:bg-sidebar-accent hover:text-foreground lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="p-6 pb-4">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
              <Calendar className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-foreground">
                {currentEvent.title === 'New Event' ? 'New Event' : currentEvent.title}
              </h1>
              <p className="text-xs text-muted-foreground">7-step setup</p>
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">Progress</span>
              <span className="text-muted-foreground">{currentStep} of {STEPS.length}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sidebar-accent">
              <div
                className="h-full rounded-full bg-gradient-brand transition-all duration-500 ease-out"
                style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">{Math.round((currentStep / STEPS.length) * 100)}% complete</p>
          </div>
        </div>

        {/* Steps nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
          {STEPS.map((step, index) => {
            const stepNumber = index + 1
            const isActive = currentStep === stepNumber
            const isCompleted = completedSteps.has(stepNumber)

            return (
              <button
                key={step.id}
                onClick={() => { setCurrentStep(stepNumber); setSidebarOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl p-3 text-left transition-smooth',
                  isActive
                    ? 'bg-primary/15 border border-primary/40'
                    : isCompleted
                    ? 'border border-border/50 bg-sidebar-accent/50 hover:border-primary/30 hover:bg-sidebar-accent'
                    : 'border border-transparent hover:border-border/50 hover:bg-sidebar-accent/50'
                )}
              >
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold transition-smooth',
                  isActive
                    ? 'bg-gradient-brand text-primary-foreground shadow-glow'
                    : isCompleted
                    ? 'bg-primary/15 text-primary'
                    : 'bg-sidebar-accent text-muted-foreground'
                )}>
                  {isCompleted ? <Check className="h-4 w-4" /> : <span>{stepNumber}</span>}
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className={cn('text-sm font-semibold', isActive ? 'text-primary' : 'text-foreground')}>
                    {step.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{step.description}</p>
                </div>
                {isActive && <ChevronRight className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </nav>

        {/* Info footer */}
        <div className="m-4 rounded-xl border border-primary/20 bg-primary/10 p-4">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Auto-saving</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Progress saved as you go</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-background" id="main-content">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
          {/* Step header */}
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span>Step {currentStep} of {STEPS.length}</span>
              <span>·</span>
              <span>{STEPS[currentStep - 1]?.name}</span>
            </div>
            <h2 className="mb-1 font-display text-3xl font-bold tracking-tight text-foreground">
              {STEPS[currentStep - 1]?.name}
            </h2>
            <p className="text-muted-foreground">{STEPS[currentStep - 1]?.description}</p>
          </div>

          {/* Content card */}
          <div className="mb-8 rounded-3xl border border-border bg-gradient-card p-6 shadow-card sm:p-8">
            {currentStep === 1 ? (
              <EventPlanningStep
                event={currentEvent}
                onNext={handleNext}
                onPrevious={handlePrevious}
                onSave={handleSaveDraft}
                currentStep={currentStep}
                totalSteps={STEPS.length}
                ensureEventReady={ensureEventReady}
              />
            ) : (
              <CurrentStepComponent
                event={currentEvent}
                onNext={handleNext}
                onPrevious={handlePrevious}
                onSave={handleSaveDraft}
                currentStep={currentStep}
                totalSteps={STEPS.length}
              />
            )}
          </div>

          {/* Bottom nav */}
          <div className="flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                onClick={handlePrevious}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-muted-foreground transition-smooth hover:bg-card hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              {currentStep < STEPS.length && (
                <button
                  onClick={handleNext}
                  className="rounded-xl px-5 py-2.5 text-sm font-medium text-muted-foreground transition-smooth hover:bg-card hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
              <Button
                variant="hero"
                onClick={handleNext}
                disabled={currentStep === STEPS.length}
              >
                {currentStep === STEPS.length ? 'Complete Event' : 'Continue'}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Auto-save indicator */}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            <span>All changes saved</span>
          </div>
        </div>
      </main>
    </div>
  )
}
