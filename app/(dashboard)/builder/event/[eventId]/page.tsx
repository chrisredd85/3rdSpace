'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Check, Calendar, ChevronRight, Info, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEvent, useUpdateEvent } from '@/lib/hooks/useEvents'
import { useUser } from '@/lib/hooks/useUser'
import { supabase } from '@/lib/supabase/client'
import { EventPlanningStep } from '@/components/builder/event-wizard/EventPlanningStep'
import { EventTeamStep } from '@/components/builder/event-wizard/EventTeamStep'
import { EventVenueStep } from '@/components/builder/event-wizard/EventVenueStep'
import { EventVendorStep } from '@/components/builder/event-wizard/EventVendorStep'
import { EventTimelineStep } from '@/components/builder/event-wizard/EventTimelineStep'
import { EventChecklistStep } from '@/components/builder/event-wizard/EventChecklistStep'
import { EventDocumentsStep } from '@/components/builder/event-wizard/EventDocumentsStep'
import { EventFinalizeStep } from '@/components/builder/event-wizard/EventFinalizeStep'
import type { Event } from '@/lib/types'

const STEPS = [
  { id: 1, name: 'Planning', description: 'Event details & team' },
  { id: 2, name: 'Team', description: 'Invite collaborators' },
  { id: 3, name: 'Venue', description: 'Find your space' },
  { id: 4, name: 'Vendors', description: 'Book services' },
  { id: 5, name: 'Timeline', description: 'Schedule your day' },
  { id: 6, name: 'Checklist', description: 'Task tracking' },
  { id: 7, name: 'Documents', description: 'Contracts & permits' },
  { id: 8, name: 'Finalize', description: 'Review & publish' },
]

export default function EventWizardPage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.eventId as string
  const [currentStep, setCurrentStep] = useState(1)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { user, isLoading: isUserLoading, error: userError } = useUser()
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [venueBooking, setVenueBooking] = useState<any>(null)
  const [vendorBookings, setVendorBookings] = useState<any[]>([])

  const userId = user?.id || null
  const isNew = eventId === 'new'
  
  const { data: event, isLoading: isEventLoading } = useEvent(isNew ? null : eventId)
  const updateEvent = useUpdateEvent()

  // Create new event if needed
  useEffect(() => {
    if (isNew && userId && !event) {
      supabase
        .from('events')
        .insert({
          builder_id: userId,
          name: 'New Event',
          status: 'planning',
        })
        .select()
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.error('Error creating event:', error)
            return
          }
          if (data) {
            router.replace(`/builder/event/${data.id}`)
          }
        })
    }
  }, [isNew, userId, event, router])

  // Calculate completed steps
  useEffect(() => {
    if (!event) return

    const completed = new Set<number>()

    if (event.name && event.event_date && event.budget) {
      completed.add(1)
    }
    completed.add(2) // Team is optional
    if (event.venue_id) {
      completed.add(3)
    }
    if (vendorBookings.length > 0) {
      completed.add(4)
    }
    if (event.venue_id && vendorBookings.length > 0) {
      completed.add(5)
    }
    completed.add(6) // Checklist always available
    completed.add(7) // Documents always available
    if (completed.size >= 7) {
      completed.add(8)
    }

    setCompletedSteps(completed)
  }, [event, vendorBookings.length])

  // Fetch venue and vendor bookings
  useEffect(() => {
    if (!event?.id) return

    supabase
      .from('venue_bookings')
      .select('*')
      .eq('event_id', event.id)
      .single()
      .then(({ data }) => {
        if (data) setVenueBooking(data)
      })
      .catch(() => {})

    supabase
      .from('vendor_bookings')
      .select('*, vendors(*)')
      .eq('event_id', event.id)
      .then(({ data }) => {
        if (data) setVendorBookings(data)
      })
      .catch(() => {})
  }, [event?.id])

  // Loading and error handling
  if (isUserLoading || isEventLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <div className="text-slate-600 font-medium">Loading event...</div>
        </div>
      </div>
    )
  }

  if (userError || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-xl font-semibold text-red-600 mb-2">Authentication Error</p>
          <p className="text-slate-600 mb-4">Please log in to continue</p>
          <Button onClick={() => router.push('/login')}>Go to Login</Button>
        </div>
      </div>
    )
  }

  if (!event && !isNew) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-xl font-semibold text-slate-900 mb-2">Event not found</p>
          <Button onClick={() => router.push('/builder')} variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  // Create default event object if new
  const currentEvent: Event = event || {
    id: 'new',
    builder_id: userId || '',
    name: 'New Event',
    event_type: '',
    event_date: new Date().toISOString(),
    event_time: '',
    expected_attendees: 0,
    min_attendees: null,
    max_attendees: null,
    budget: 0,
    actual_cost: null,
    status: 'planning',
    description: null,
    venue_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1)
      setSidebarOpen(false) // Close mobile sidebar
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
      setSidebarOpen(false)
    }
  }

  const handleSaveDraft = async () => {
    if (!event?.id) return
    try {
      await updateEvent.mutateAsync({
        id: event.id,
        updates: {
          status: 'planning',
          updated_at: new Date().toISOString(),
        },
      })
    } catch (error) {
      console.error('Error saving draft:', error)
    }
  }

  const completionPercentage = useMemo(() => {
    return Math.round((completedSteps.size / STEPS.length) * 100)
  }, [completedSteps.size])

  // Map step number to component
  const getStepComponent = () => {
    switch (currentStep) {
      case 1:
        return EventPlanningStep
      case 2:
        return EventTeamStep
      case 3:
        return EventVenueStep
      case 4:
        return EventVendorStep
      case 5:
        return EventTimelineStep
      case 6:
        return EventChecklistStep
      case 7:
        return EventDocumentsStep
      case 8:
        return EventFinalizeStep
      default:
        return EventPlanningStep
    }
  }

  const CurrentStepComponent = getStepComponent()

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Mobile Menu Button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-12 h-12 bg-white rounded-xl shadow-lg border-2 border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors"
        aria-label="Open sidebar"
      >
        <Menu className="w-6 h-6 text-slate-700" />
      </button>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <>
          <div 
            className="lg:hidden fixed inset-0 bg-slate-900/50 z-40 transition-opacity"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        </>
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 w-80 bg-gradient-to-b from-slate-50 to-white border-r border-slate-200 p-8 flex flex-col z-50
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Close button (mobile only) */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          aria-label="Close sidebar"
        >
          <X className="w-5 h-5 text-slate-600" />
        </button>

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-forest-500 rounded-lg flex items-center justify-center shadow-lg shadow-forest-500/20">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">New Event</h1>
              <p className="text-sm text-slate-500">8-step setup</p>
            </div>
          </div>
          
          {/* Progress indicator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Progress</span>
              <span className="text-slate-500">{currentStep} of 8</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-forest-500 to-forest-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(currentStep / 8) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-500">{completionPercentage}% complete</p>
          </div>
        </div>

        {/* Steps navigation */}
        <nav className="flex-1 space-y-3 overflow-y-auto">
          {STEPS.map((step, index) => {
            const stepNumber = index + 1
            const isActive = currentStep === stepNumber
            const isCompleted = completedSteps.has(stepNumber)
            
            return (
              <button
                key={step.id}
                onClick={() => {
                  // Allow clicking on any step - all steps are accessible
                  setCurrentStep(stepNumber)
                  setSidebarOpen(false)
                }}
                className={`
                  w-full flex items-center gap-4 p-4 rounded-xl transition-all duration-200
                  ${isActive 
                    ? 'bg-forest-50 border-2 border-forest-500 shadow-sm' 
                    : isCompleted
                    ? 'bg-white border border-slate-200 hover:border-forest-200 hover:bg-forest-50/50 cursor-pointer'
                    : 'bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer'
                  }
                `}
                aria-label={`Step ${stepNumber}: ${step.name}`}
              >
                {/* Step number/checkmark */}
                <div className={`
                  flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-semibold transition-all
                  ${isActive 
                    ? 'bg-forest-500 text-white shadow-lg shadow-forest-500/30'
                    : isCompleted
                    ? 'bg-forest-100 text-forest-700'
                    : 'bg-slate-200 text-slate-600'
                  }
                `}>
                  {isCompleted ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <span>{stepNumber}</span>
                  )}
                </div>
                
                {/* Step info */}
                <div className="flex-1 text-left">
                  <div className={`font-semibold ${
                    isActive ? 'text-forest-700' : 'text-slate-700'
                  }`}>
                    {step.name}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {step.description}
                  </div>
                </div>
                
                {/* Status indicator */}
                {isActive && (
                  <ChevronRight className="w-5 h-5 text-forest-500 animate-pulse" />
                )}
              </button>
            )
          })}
        </nav>

        {/* Footer help */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-900">Need help?</p>
              <p className="text-xs text-blue-700 mt-1">
                We'll save your progress automatically
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-slate-50 overflow-y-auto" id="main-content">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
          {/* Step header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
              <span>Step {currentStep} of 8</span>
              <span>•</span>
              <span>{STEPS[currentStep - 1]?.name}</span>
            </div>
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
              {STEPS[currentStep - 1]?.name}
            </h2>
            <p className="text-lg text-slate-600">
              {STEPS[currentStep - 1]?.description}
            </p>
          </div>

          {/* Content card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 mb-8">
            <CurrentStepComponent
              event={currentEvent}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onSave={handleSaveDraft}
              currentStep={currentStep}
              totalSteps={STEPS.length}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                onClick={handlePrevious}
                className="flex items-center gap-2 px-6 py-3 text-slate-700 hover:text-slate-900 font-medium transition-colors rounded-xl hover:bg-white"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            ) : (
              <div />
            )}
            
            <div className="flex items-center gap-3">
              {/* Show "Skip for now" on all steps except the last one */}
              {currentStep < STEPS.length && (
                <button
                  onClick={handleNext}
                  className="px-6 py-3 text-slate-600 hover:text-slate-900 font-medium transition-colors rounded-xl hover:bg-white min-h-[44px]"
                >
                  Skip for now
                </button>
              )}
              
              <button
                onClick={handleNext}
                disabled={currentStep === STEPS.length}
                className="
                  px-8 py-3 bg-forest-500 hover:bg-forest-600 
                  disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
                  text-white font-semibold rounded-xl 
                  shadow-lg shadow-forest-500/20 hover:shadow-xl hover:shadow-forest-500/30
                  transition-all duration-200 hover:scale-105 active:scale-95
                  flex items-center gap-2 min-h-[44px]
                "
              >
                {currentStep === STEPS.length ? 'Complete Event' : 'Continue'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Auto-save indicator */}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>All changes saved</span>
          </div>
        </div>
      </main>
    </div>
  )
}
