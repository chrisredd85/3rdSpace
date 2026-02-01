'use client'

import { useState, useMemo } from 'react'
import { Check, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVendors } from '@/lib/hooks/useVendors'
import { useCreateVendorBooking } from '@/lib/hooks/useBookings'
import { useToast } from '@/components/ui/toast'
import type { Event, ServiceType, Vendor } from '@/lib/types'

interface EventVendorStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: 'dj', label: 'DJ' },
  { value: 'catering', label: 'Catering' },
  { value: 'bartending', label: 'Bar' },
  { value: 'photography', label: 'Photo' },
  { value: 'videography', label: 'Video' },
  { value: 'av_tech', label: 'A/V' },
]

export function EventVendorStep({
  event,
  onNext,
  currentStep,
}: EventVendorStepProps) {
  const [selectedServiceTypes, setSelectedServiceTypes] = useState<ServiceType[]>([])
  const [selectedVendors, setSelectedVendors] = useState<Set<string>>(new Set())
  const { addToast } = useToast()
  const createVendorBooking = useCreateVendorBooking()

  // Only fetch vendors when this step is active (Step 4)
  const { data: vendors = [], isLoading: vendorsLoading, error: vendorsError } = useVendors(
    undefined,
    { enabled: currentStep === 4 }
  )

  // All hooks must be called before any conditional returns
  const filteredVendors = useMemo(() => {
    if (selectedServiceTypes.length === 0) return []
    return vendors.filter((vendor) =>
      selectedServiceTypes.includes(vendor.service_type)
    )
  }, [vendors, selectedServiceTypes])

  // Show loading state (after all hooks)
  if (vendorsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-forest-500 border-t-transparent mx-auto mb-4" />
          <p className="text-slate-600 font-medium">Loading vendors...</p>
        </div>
      </div>
    )
  }

  // Show error state gracefully
  if (vendorsError) {
    return (
      <div className="text-center py-16">
        <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl">
          <Package className="w-10 h-10 text-slate-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Unable to load vendors</h3>
        <p className="text-slate-600 mb-6">You can continue to the next step and add vendors later.</p>
        <button
          onClick={onNext}
          className="px-6 py-3 bg-forest-500 hover:bg-forest-600 text-white font-semibold rounded-xl transition-all shadow-lg shadow-forest-500/20 hover:shadow-xl hover:shadow-forest-500/30 hover:scale-105 min-h-[44px]"
        >
          Continue Without Vendors
        </button>
      </div>
    )
  }

  const handleSelectVendor = async (vendor: Vendor) => {
    if (!event) return

    try {
      await createVendorBooking.mutateAsync({
        event_id: event.id,
        vendor_id: vendor.id,
        vendor_offering_id: null,
        vendor_package_id: null,
        requested_date: event.event_date,
        requested_start_time: event.start_time || (event as { event_time?: string }).event_time || null,
        requested_end_time: null,
        status: 'pending',
        quoted_price: null,
        confirmed_date: null,
        confirmed_start_time: null,
        confirmed_end_time: null,
        final_price: null,
        quantity: null,
        deposit_amount: null,
        deposit_paid: false,
        notes: null,
      })

      setSelectedVendors(new Set([...selectedVendors, vendor.id]))
      addToast({
        title: 'Vendor selected',
        description: 'Vendor booking request has been created.',
      })
    } catch (error) {
      addToast({
        title: 'Error',
        description: 'Failed to select vendor',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
          {/* Service Type Selection */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Service Types Needed</p>
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map((service) => (
                <button
                  key={service.value}
                  onClick={() => {
                    if (selectedServiceTypes.includes(service.value)) {
                      setSelectedServiceTypes(
                        selectedServiceTypes.filter((s) => s !== service.value)
                      )
                    } else {
                      setSelectedServiceTypes([...selectedServiceTypes, service.value])
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                    selectedServiceTypes.includes(service.value)
                      ? 'bg-forest-500 text-white border-forest-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-forest-500'
                  }`}
                >
                  {service.label}
                </button>
              ))}
            </div>
          </div>

          {/* Vendor Results */}
          {selectedServiceTypes.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">
                Available Vendors ({filteredVendors.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredVendors.map((vendor) => (
                  <button
                    key={vendor.id}
                    onClick={() => handleSelectVendor(vendor)}
                    className={`
                      group relative text-left bg-white rounded-2xl border-2 
                      transition-all duration-300 overflow-hidden
                      hover:shadow-xl hover:scale-[1.02]
                      ${selectedVendors.has(vendor.id) 
                        ? 'border-forest-500 shadow-xl shadow-forest-500/20 ring-4 ring-forest-500/10' 
                        : 'border-slate-200 hover:border-forest-300'
                      }
                    `}
                  >
                    {selectedVendors.has(vendor.id) && (
                      <div className="absolute -top-3 -right-3 w-10 h-10 bg-forest-500 rounded-full flex items-center justify-center shadow-lg shadow-forest-500/50 z-10">
                        <Check className="w-6 h-6 text-white" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-bold text-lg text-slate-900 mb-2 group-hover:text-forest-600 transition-colors">
                        {vendor.name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                        <Package className="w-4 h-4 text-slate-400" />
                        <span className="capitalize">{vendor.service_type.replace('_', ' ')}</span>
                      </div>
                      {vendor.description && (
                        <p className="text-xs text-slate-500 line-clamp-2">
                          {vendor.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedServiceTypes.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-600 mb-2">Select service types to see available vendors</p>
              <p className="text-sm text-gray-500">Choose the services you need for your event</p>
            </div>
          )}

          {selectedServiceTypes.length > 0 && filteredVendors.length === 0 && vendors.length === 0 && (
            <div className="text-center py-12">
              <div className="mb-4">
                <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              </div>
              <p className="text-lg font-semibold text-gray-900 mb-2">No vendors available</p>
              <p className="text-sm text-gray-600 mb-6">
                There are currently no vendors available for the selected service types. You can continue planning your event and add vendors later.
              </p>
              <Button onClick={onNext} className="min-h-[44px]">
                Continue Without Vendors
              </Button>
            </div>
          )}

          {selectedServiceTypes.length > 0 && filteredVendors.length === 0 && vendors.length > 0 && (
            <div className="text-center py-12">
              <p className="text-gray-600 mb-2">No vendors found for the selected service types</p>
              <p className="text-sm text-gray-500">Try selecting different service types</p>
            </div>
          )}
    </div>
  )
}
