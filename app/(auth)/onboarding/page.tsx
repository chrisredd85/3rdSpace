'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, Store, Users, MapPin, Upload, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useUser } from '@/lib/hooks/useUser'
import type { UserType, VenueType, ServiceType } from '@/lib/types'

// Venue onboarding schema
const venueOnboardingSchema = z.object({
  venue_name: z.string().min(2, 'Venue name must be at least 2 characters'),
  address: z.string().min(5, 'Please enter a valid address'),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  zip_code: z.string().min(5, 'ZIP code is required'),
  venue_type: z.enum(['loft_warehouse', 'gallery', 'restaurant', 'rooftop', 'conference_center', 'other']),
  capacity: z.number().min(1, 'Capacity must be at least 1'),
})

// Vendor onboarding schema
const vendorOnboardingSchema = z.object({
  business_name: z.string().min(2, 'Business name must be at least 2 characters'),
  service_type: z.enum(['dj', 'catering', 'bartending', 'photography', 'videography', 'av_tech', 'event_planning', 'florist', 'other']),
  service_area: z.string().min(2, 'Service area is required'),
  setup_time: z.enum(['30min', '60min', '90min', '2hr', '3hr']),
  description: z.string().optional(),
})

// Builder onboarding schema (optional)
const builderOnboardingSchema = z.object({
  company_name: z.string().optional(),
  typical_event_types: z.array(z.string()).optional(),
})

type VenueOnboardingInput = z.infer<typeof venueOnboardingSchema>
type VendorOnboardingInput = z.infer<typeof vendorOnboardingSchema>
type BuilderOnboardingInput = z.infer<typeof builderOnboardingSchema>

export default function OnboardingPage() {
  const router = useRouter()
  const { user, isLoading: isUserLoading } = useUser()
  const { addToast } = useToast()
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true)

  // Redirect if not authenticated
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login')
    }
  }, [user, isUserLoading, router])

  // Check if user has already completed onboarding
  useEffect(() => {
    const checkOnboarding = async () => {
      if (!user) return

      try {
        const response = await fetch('/api/onboarding/check')
        const result = await response.json()

        if (result.isOnboarded) {
          // User already onboarded, redirect to dashboard
          if (user.userType === 'venue_owner') {
            router.push('/venue')
          } else if (user.userType === 'vendor') {
            router.push('/vendor')
          } else {
            router.push('/builder')
          }
          return
        }

        setIsCheckingOnboarding(false)
      } catch (error) {
        console.error('Error checking onboarding:', error)
        setIsCheckingOnboarding(false)
      }
    }

    if (user) {
      checkOnboarding()
    }
  }, [user, router])

  // Show loading while fetching user or checking onboarding
  if (isUserLoading || isCheckingOnboarding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // Render appropriate form based on user type
  if (user.userType === 'venue_owner') {
    return <VenueOnboardingForm user={user} />
  }

  if (user.userType === 'vendor') {
    return <VendorOnboardingForm user={user} />
  }

  if (user.userType === 'community_builder') {
    return <BuilderOnboardingForm user={user} />
  }

  // Fallback: redirect to dashboard
  router.push('/builder')
  return null
}

// Venue Owner Onboarding Form
function VenueOnboardingForm({ user }: { user: { id: string; email: string | null; name: string; userType: string | null } }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VenueOnboardingInput>({
    resolver: zodResolver(venueOnboardingSchema),
  })

  const onSubmit = async (data: VenueOnboardingInput) => {
    setIsSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('venue_name', data.venue_name)
      formData.append('address', data.address)
      formData.append('city', data.city)
      formData.append('state', data.state)
      formData.append('zip_code', data.zip_code)
      formData.append('venue_type', data.venue_type)
      formData.append('capacity', data.capacity.toString())
      if (photoFile) {
        formData.append('photo', photoFile)
      }

      const response = await fetch('/api/onboarding/venue', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Onboarding failed',
          description: result.error || 'Failed to complete onboarding. Please try again.',
          variant: 'destructive',
        })
        setIsSubmitting(false)
        return
      }

      addToast({
        title: 'Welcome to 3rdSpace!',
        description: 'Your venue profile has been created successfully.',
      })

      router.push('/venue')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Connection failed. Please try again.',
        variant: 'destructive',
      })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-forest-50 mb-4 mx-auto">
            <Building2 className="h-8 w-8 text-forest-600" />
          </div>
          <CardTitle className="text-3xl font-bold">Complete Your Venue Profile</CardTitle>
          <CardDescription>
            Let's set up your venue so you can start receiving bookings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="venue_name" className="text-sm font-medium text-gray-700">
                Venue Name *
              </label>
              <Input
                id="venue_name"
                placeholder="The Grand Hall"
                {...register('venue_name')}
              />
              {errors.venue_name && (
                <p className="text-sm text-red-500">{errors.venue_name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="address" className="text-sm font-medium text-gray-700">
                  Address *
                </label>
                <Input
                  id="address"
                  placeholder="123 Main St"
                  {...register('address')}
                />
                {errors.address && (
                  <p className="text-sm text-red-500">{errors.address.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="city" className="text-sm font-medium text-gray-700">
                  City *
                </label>
                <Input
                  id="city"
                  placeholder="San Francisco"
                  {...register('city')}
                />
                {errors.city && (
                  <p className="text-sm text-red-500">{errors.city.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="state" className="text-sm font-medium text-gray-700">
                  State *
                </label>
                <Input
                  id="state"
                  placeholder="CA"
                  maxLength={2}
                  {...register('state')}
                />
                {errors.state && (
                  <p className="text-sm text-red-500">{errors.state.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="zip_code" className="text-sm font-medium text-gray-700">
                  ZIP Code *
                </label>
                <Input
                  id="zip_code"
                  placeholder="94102"
                  {...register('zip_code')}
                />
                {errors.zip_code && (
                  <p className="text-sm text-red-500">{errors.zip_code.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="venue_type" className="text-sm font-medium text-gray-700">
                  Venue Type *
                </label>
                <select
                  id="venue_type"
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm"
                  {...register('venue_type')}
                >
                  <option value="">Select venue type</option>
                  <option value="loft_warehouse">Loft/Warehouse</option>
                  <option value="gallery">Gallery</option>
                  <option value="restaurant">Restaurant</option>
                  <option value="rooftop">Rooftop</option>
                  <option value="conference_center">Conference Center</option>
                  <option value="other">Other</option>
                </select>
                {errors.venue_type && (
                  <p className="text-sm text-red-500">{errors.venue_type.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="capacity" className="text-sm font-medium text-gray-700">
                  Capacity *
                </label>
                <Input
                  id="capacity"
                  type="number"
                  placeholder="100"
                  {...register('capacity', { valueAsNumber: true })}
                />
                {errors.capacity && (
                  <p className="text-sm text-red-500">{errors.capacity.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="photo" className="text-sm font-medium text-gray-700">
                Venue Photo (Optional)
              </label>
              <div className="flex items-center gap-4">
                <label
                  htmlFor="photo-upload"
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-sm">Choose Photo</span>
                </label>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                />
                {photoFile && (
                  <span className="text-sm text-gray-600">{photoFile.name}</span>
                )}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating profile...' : (
                <>
                  Complete Setup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Vendor Onboarding Form
function VendorOnboardingForm({ user }: { user: { id: string; email: string | null; name: string; userType: string | null } }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorOnboardingInput>({
    resolver: zodResolver(vendorOnboardingSchema),
  })

  const onSubmit = async (data: VendorOnboardingInput) => {
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/onboarding/vendor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Onboarding failed',
          description: result.error || 'Failed to complete onboarding. Please try again.',
          variant: 'destructive',
        })
        setIsSubmitting(false)
        return
      }

      addToast({
        title: 'Welcome to 3rdSpace!',
        description: 'Your vendor profile has been created successfully.',
      })

      router.push('/vendor')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Connection failed. Please try again.',
        variant: 'destructive',
      })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-forest-50 mb-4 mx-auto">
            <Store className="h-8 w-8 text-forest-600" />
          </div>
          <CardTitle className="text-3xl font-bold">Complete Your Vendor Profile</CardTitle>
          <CardDescription>
            Let's set up your business so you can start receiving booking requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="business_name" className="text-sm font-medium text-gray-700">
                Business Name *
              </label>
              <Input
                id="business_name"
                placeholder="Elite Catering Co."
                {...register('business_name')}
              />
              {errors.business_name && (
                <p className="text-sm text-red-500">{errors.business_name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label htmlFor="service_type" className="text-sm font-medium text-gray-700">
                  Service Type *
                </label>
                <select
                  id="service_type"
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm"
                  {...register('service_type')}
                >
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
                {errors.service_type && (
                  <p className="text-sm text-red-500">{errors.service_type.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <label htmlFor="setup_time" className="text-sm font-medium text-gray-700">
                  Setup Time Required *
                </label>
                <select
                  id="setup_time"
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm"
                  {...register('setup_time')}
                >
                  <option value="">Select setup time</option>
                  <option value="30min">30 minutes</option>
                  <option value="60min">1 hour</option>
                  <option value="90min">1.5 hours</option>
                  <option value="2hr">2 hours</option>
                  <option value="3hr">3 hours</option>
                </select>
                {errors.setup_time && (
                  <p className="text-sm text-red-500">{errors.setup_time.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="service_area" className="text-sm font-medium text-gray-700">
                Service Area *
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="service_area"
                  placeholder="San Francisco, CA"
                  className="pl-10"
                  {...register('service_area')}
                />
              </div>
              {errors.service_area && (
                <p className="text-sm text-red-500">{errors.service_area.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium text-gray-700">
                Description (Optional)
              </label>
              <textarea
                id="description"
                rows={4}
                className="flex w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm"
                placeholder="Tell us about your services..."
                {...register('description')}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating profile...' : (
                <>
                  Complete Setup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Community Builder Onboarding Form (Optional)
function BuilderOnboardingForm({ user }: { user: { id: string; email: string | null; name: string; userType: string | null } }) {
  const router = useRouter()
  const { addToast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
  } = useForm<BuilderOnboardingInput>({
    resolver: zodResolver(builderOnboardingSchema),
  })

  const onSubmit = async (data: BuilderOnboardingInput) => {
    setIsSubmitting(true)
    try {
      // For builders, onboarding is optional - just redirect to dashboard
      // Could save company_name to profile if needed
      
      addToast({
        title: 'Welcome to 3rdSpace!',
        description: 'You\'re all set! Start creating your first event.',
      })

      router.push('/builder')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-forest-50 mb-4 mx-auto">
            <Users className="h-8 w-8 text-forest-600" />
          </div>
          <CardTitle className="text-3xl font-bold">Welcome to 3rdSpace!</CardTitle>
          <CardDescription>
            You're ready to start creating events. Optionally, tell us a bit about yourself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="company_name" className="text-sm font-medium text-gray-700">
                Company/Organization Name (Optional)
              </label>
              <Input
                id="company_name"
                placeholder="Acme Events"
                {...register('company_name')}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Setting up...' : (
                <>
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
