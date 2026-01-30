'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import Link from 'next/link'
import {
  Users,
  Building2,
  Store,
  ArrowRight,
  ArrowLeft,
  Mail,
  Lock,
  Phone,
  MapPin,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  builderSignupSchema,
  venueSignupSchema,
  vendorSignupSchema,
  type BuilderSignupInput,
  type VenueSignupInput,
  type VendorSignupInput,
} from '@/lib/validations/auth'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/toast'
import type { UserType, VenueType, ServiceType } from '@/lib/types'

type SignupStep = 'select-type' | 'form'

export default function SignupPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [step, setStep] = useState<SignupStep>('select-type')
  const [userType, setUserType] = useState<UserType | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)

  const handleUserTypeSelect = (type: UserType) => {
    setUserType(type)
    setStep('form')
  }

  const handleBack = () => {
    setStep('select-type')
    setUserType(null)
  }

  const handleGoogleSignUp = async () => {
    setIsGoogleLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (error) {
        addToast({
          title: 'Google sign up failed',
          description: error.message,
          variant: 'destructive',
        })
        setIsGoogleLoading(false)
      }
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      })
      setIsGoogleLoading(false)
    }
  }

  if (step === 'select-type') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
        <div className="w-full max-w-4xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Join 3rdSpace
            </h1>
            <p className="text-lg text-gray-600">
              Choose your account type to get started
            </p>
          </div>

          {/* SSO Options */}
          <div className="mb-8 space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignUp}
              disabled={isGoogleLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {isGoogleLoading ? 'Connecting...' : 'Continue with Google'}
            </Button>
          </div>

          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-gray-50 px-2 text-gray-500">Or select an account type</span>
            </div>
          </div>

          {/* User Type Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Community Builder */}
            <Card
              className="cursor-pointer transition-all hover:border-forest-500 hover:shadow-lg"
              onClick={() => handleUserTypeSelect('community_builder')}
            >
              <CardHeader>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-forest-50 mb-4">
                  <Users className="h-6 w-6 text-forest-600" />
                </div>
                <CardTitle>Community Builder</CardTitle>
                <CardDescription>
                  Organize and host events in your community
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Create and manage events
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Book venues and vendors
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Connect with local businesses
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Venue Owner */}
            <Card
              className="cursor-pointer transition-all hover:border-forest-500 hover:shadow-lg"
              onClick={() => handleUserTypeSelect('venue_owner')}
            >
              <CardHeader>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-forest-50 mb-4">
                  <Building2 className="h-6 w-6 text-forest-600" />
                </div>
                <CardTitle>Venue Owner</CardTitle>
                <CardDescription>
                  List your space and host events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Showcase your venue
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Manage bookings
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Set your pricing
                  </li>
                </ul>
              </CardContent>
            </Card>

            {/* Vendor */}
            <Card
              className="cursor-pointer transition-all hover:border-forest-500 hover:shadow-lg"
              onClick={() => handleUserTypeSelect('vendor')}
            >
              <CardHeader>
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-forest-50 mb-4">
                  <Store className="h-6 w-6 text-forest-600" />
                </div>
                <CardTitle>Vendor</CardTitle>
                <CardDescription>
                  Offer your services to event organizers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Create service listings
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Receive booking requests
                  </li>
                  <li className="flex items-center">
                    <ArrowRight className="h-4 w-4 mr-2 text-forest-500" />
                    Grow your business
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="text-center mt-8">
            <span className="text-gray-600">Already have an account? </span>
            <Link
              href="/login"
              className="font-medium text-forest-600 hover:text-forest-700 hover:underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Render form based on user type
  if (userType === 'community_builder') {
    return (
      <BuilderSignupForm
        onBack={handleBack}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        router={router}
      />
    )
  }

  if (userType === 'venue_owner') {
    return (
      <VenueSignupForm
        onBack={handleBack}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        router={router}
      />
    )
  }

  if (userType === 'vendor') {
    return (
      <VendorSignupForm
        onBack={handleBack}
        isLoading={isLoading}
        setIsLoading={setIsLoading}
        router={router}
      />
    )
  }

  return null
}

// Community Builder Signup Form
function BuilderSignupForm({
  onBack,
  isLoading,
  setIsLoading,
  router,
}: {
  onBack: () => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  router: ReturnType<typeof useRouter>
}) {
  const { addToast } = useToast()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BuilderSignupInput>({
    resolver: zodResolver(builderSignupSchema),
  })

  const onSubmit = async (data: BuilderSignupInput) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userType: 'community_builder',
          email: data.email,
          password: data.password,
          name: data.name,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Sign up failed',
          description: result.error || 'Failed to create account',
          variant: 'destructive',
        })
        setIsLoading(false)
        return
      }

      addToast({
        title: 'Account created!',
        description: 'Welcome to 3rdSpace! Let\'s complete your profile.',
      })

      router.push('/onboarding')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      })
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Button
            variant="ghost"
            onClick={onBack}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <CardTitle className="text-3xl font-bold">Create your account</CardTitle>
          <CardDescription>
            Join as a Community Builder to start organizing events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium text-gray-700">
                Full Name
              </label>
              <Input
                id="name"
                placeholder="John Doe"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  {...register('password')}
                />
              </div>
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Venue Owner Signup Form
function VenueSignupForm({
  onBack,
  isLoading,
  setIsLoading,
  router,
}: {
  onBack: () => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  router: ReturnType<typeof useRouter>
}) {
  const { addToast } = useToast()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VenueSignupInput>({
    resolver: zodResolver(venueSignupSchema),
  })

  const onSubmit = async (data: VenueSignupInput) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userType: 'venue_owner',
          email: data.email,
          password: data.password,
          name: data.contact_name,
          venue_name: data.venue_name,
          venue_type: data.venue_type,
          capacity: data.capacity,
          phone: data.phone,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Sign up failed',
          description: result.error || 'Failed to create account',
          variant: 'destructive',
        })
        setIsLoading(false)
        return
      }

      addToast({
        title: 'Account created!',
        description: 'Welcome to 3rdSpace! Let\'s complete your venue profile.',
      })

      router.push('/onboarding')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      })
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Button
            variant="ghost"
            onClick={onBack}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <CardTitle className="text-3xl font-bold">Create your account</CardTitle>
          <CardDescription>
            Join as a Venue Owner to list your space
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="venue_name" className="text-sm font-medium text-gray-700">
                Venue Name
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

            <div className="space-y-2">
              <label htmlFor="contact_name" className="text-sm font-medium text-gray-700">
                Contact Name
              </label>
              <Input
                id="contact_name"
                placeholder="John Doe"
                {...register('contact_name')}
              />
              {errors.contact_name && (
                <p className="text-sm text-red-500">{errors.contact_name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium text-gray-700">
                Phone
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  className="pl-10"
                  {...register('phone')}
                />
              </div>
              {errors.phone && (
                <p className="text-sm text-red-500">{errors.phone.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="venue_type" className="text-sm font-medium text-gray-700">
                Venue Type
              </label>
              <select
                id="venue_type"
                className="flex h-10 w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm"
                {...register('venue_type', { valueAsNumber: false })}
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
                Capacity
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

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  {...register('password')}
                />
              </div>
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// Vendor Signup Form
function VendorSignupForm({
  onBack,
  isLoading,
  setIsLoading,
  router,
}: {
  onBack: () => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  router: ReturnType<typeof useRouter>
}) {
  const { addToast } = useToast()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<VendorSignupInput>({
    resolver: zodResolver(vendorSignupSchema),
  })

  const onSubmit = async (data: VendorSignupInput) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userType: 'vendor',
          email: data.email,
          password: data.password,
          name: data.your_name,
          business_name: data.business_name,
          service_type: data.service_type,
          service_area: data.service_area,
          phone: data.phone,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        addToast({
          title: 'Sign up failed',
          description: result.error || 'Failed to create account',
          variant: 'destructive',
        })
        setIsLoading(false)
        return
      }

      addToast({
        title: 'Account created!',
        description: 'Welcome to 3rdSpace! Let\'s complete your vendor profile.',
      })

      router.push('/onboarding')
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'An unexpected error occurred. Please try again.',
        variant: 'destructive',
      })
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Button
            variant="ghost"
            onClick={onBack}
            className="mb-4 -ml-2"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <CardTitle className="text-3xl font-bold">Create your account</CardTitle>
          <CardDescription>
            Join as a Vendor to offer your services
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="business_name" className="text-sm font-medium text-gray-700">
                Business Name
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

            <div className="space-y-2">
              <label htmlFor="your_name" className="text-sm font-medium text-gray-700">
                Your Name
              </label>
              <Input
                id="your_name"
                placeholder="John Doe"
                {...register('your_name')}
              />
              {errors.your_name && (
                <p className="text-sm text-red-500">{errors.your_name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  className="pl-10"
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium text-gray-700">
                Phone
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  className="pl-10"
                  {...register('phone')}
                />
              </div>
              {errors.phone && (
                <p className="text-sm text-red-500">{errors.phone.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="service_type" className="text-sm font-medium text-gray-700">
                Service Type
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
              <label htmlFor="service_area" className="text-sm font-medium text-gray-700">
                Service Area
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="service_area"
                  placeholder="New York, NY"
                  className="pl-10"
                  {...register('service_area')}
                />
              </div>
              {errors.service_area && (
                <p className="text-sm text-red-500">{errors.service_area.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  {...register('password')}
                />
              </div>
              {errors.password && (
                <p className="text-sm text-red-500">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
