'use client'

import { useState, useMemo } from 'react'
import { Check, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVendors } from '@/lib/hooks/useVendors'
import { useCreateVendorBooking } from '@/lib/hooks/useBookings'
import { useToast } from '@/components/ui/toast'
import { DepositDisplay } from '@/components/builder/DepositDisplay'
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

/**
 * Calculates the deposit due for a vendor booking request.
 *
 * Vendors may not have a quote selected yet, so percentage deposits are stored
 * once a quote exists; fixed deposits can be stored immediately.
 *
 * @param vendor - Vendor with optional deposit configuration.
 * @param bookingCost - Current quoted vendor cost, when known.
 * @returns Deposit amount to store on the booking, or null when not available.
 */
function calculateVendorDeposit(vendor: Vendor, bookingCost: number | null) {
  if (!vendor.requires_deposit) return null

  if (vendor.deposit_type === 'percentage') {
    return bookingCost && vendor.deposit_percentage
      ? bookingCost * (vendor.deposit_percentage / 100)
      : null
  }

  return vendor.deposit_amount || null
}

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
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground font-medium">Loading vendors...</p>
        </div>
      </div>
    )
  }

  // Show error state gracefully
  if (vendorsError) {
    return (
      <div className="text-center py-16">
        <div className="mb-6 inline-flex items-center justify-center w-20 h-20 bg-sidebar-accent rounded-2xl">
          <Package className="w-10 h-10 text-muted-foreground/60" />
        </div>
        <h3 className="text-xl font-bold text-foreground mb-2">Unable to load vendors</h3>
        <p className="text-muted-foreground mb-6">You can continue to the next step and add vendors later.</p>
        <button
          onClick={onNext}
          className="px-6 py-3 bg-gradient-brand text-primary-foreground font-semibold rounded-xl transition-smooth shadow-glow hover:shadow-coral hover:-translate-y-0.5 min-h-[44px]"
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
        deposit_amount: calculateVendorDeposit(vendor, null),
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
            <p className="text-sm font-semibold text-foreground mb-3">Service Types Needed</p>
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
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-smooth ${
                    selectedServiceTypes.includes(service.value)
                      ? 'bg-gradient-brand text-primary-foreground border-transparent shadow-glow'
                      : 'border-border bg-card/40 text-foreground hover:border-primary/40 hover:bg-card'
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
              <p className="text-sm font-semibold text-foreground mb-3">
                Available Vendors ({filteredVendors.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredVendors.map((vendor) => (
                  <button
                    key={vendor.id}
                    onClick={() => handleSelectVendor(vendor)}
                    className={`group relative text-left rounded-2xl border transition-smooth overflow-hidden hover:scale-[1.02] ${
                      selectedVendors.has(vendor.id)
                        ? 'border-primary shadow-glow ring-2 ring-primary/20 bg-gradient-card'
                        : 'border-border bg-gradient-card hover:border-primary/50 hover:shadow-glow'
                    }`}
                  >
                    {selectedVendors.has(vendor.id) && (
                      <div className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-brand shadow-glow">
                        <Check className="h-5 w-5 text-primary-foreground" />
                      </div>
                    )}
                    <div className="p-5">
                      <h3 className="font-display text-lg font-bold text-foreground mb-2 transition-smooth group-hover:text-primary">
                        {vendor.name}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                        <Package className="h-4 w-4 text-muted-foreground/60" />
                        <span className="capitalize">{vendor.service_type.replace('_', ' ')}</span>
                      </div>
                      {vendor.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{vendor.description}</p>
                      )}
                      <div className="mt-4">
                        <DepositDisplay vendorId={vendor.id} targetType="vendor" compact />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedServiceTypes.length === 0 && (
            <div className="text-center py-12">
              <p className="text-foreground mb-2">Select service types to see available vendors</p>
              <p className="text-sm text-muted-foreground">Choose the services you need for your event</p>
            </div>
          )}

          {selectedServiceTypes.length > 0 && filteredVendors.length === 0 && vendors.length === 0 && (
            <div className="text-center py-12">
              <div className="mb-4">
                <Package className="h-16 w-16 text-muted-foreground/60 mx-auto mb-4" />
              </div>
              <p className="text-lg font-semibold text-foreground mb-2">No vendors available</p>
              <p className="text-sm text-muted-foreground mb-6">
                There are currently no vendors available for the selected service types. You can continue planning your event and add vendors later.
              </p>
              <Button onClick={onNext} className="min-h-[44px]">
                Continue Without Vendors
              </Button>
            </div>
          )}

          {selectedServiceTypes.length > 0 && filteredVendors.length === 0 && vendors.length > 0 && (
            <div className="text-center py-12">
              <p className="text-foreground mb-2">No vendors found for the selected service types</p>
              <p className="text-sm text-muted-foreground">Try selecting different service types</p>
            </div>
          )}
    </div>
  )
}
