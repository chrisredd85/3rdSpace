'use client'

import { X, Clock, DollarSign, Package, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { VendorDiscoveryResult, VendorDiscoveryService } from '@/lib/vendors/discovery'

interface ServiceSelectionModalProps {
  vendor: VendorDiscoveryResult
  onClose: () => void
}

/**
 * Formats service price for the picker.
 *
 * @param amount - Price amount.
 * @returns Currency string.
 */
function formatPrice(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Lets builders choose a vendor service/package before starting an event booking.
 *
 * @param props - Vendor and close handler.
 * @returns Service selection modal.
 */
export function ServiceSelectionModal({ vendor, onClose }: ServiceSelectionModalProps) {
  const router = useRouter()
  const services = Array.isArray(vendor.services) ? vendor.services : []

  /**
   * Starts the event flow with the selected vendor service.
   *
   * @param service - Selected service.
   */
  function selectService(service: VendorDiscoveryService) {
    const params = new URLSearchParams({
      vendor: vendor.id,
      service: service.id,
      serviceType: service.type,
    })
    router.push(`/builder/event/new?${params.toString()}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Select a Service</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{vendor.business_name || vendor.name}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {services.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="font-semibold text-foreground">No published services yet</p>
              <p className="mt-1 text-sm text-muted-foreground">You can still start an event with this vendor and define the service request there.</p>
              <Button type="button" className="mt-4" onClick={() => router.push(`/builder/event/new?vendor=${vendor.id}`)}>
                Start Custom Request
              </Button>
            </div>
          ) : (
            services.map((service) => (
              <button
                key={`${service.type}-${service.id}`}
                type="button"
                onClick={() => selectService(service)}
                className="w-full rounded-lg border border-border p-4 text-left transition hover:border-primary/40 hover:bg-primary/10"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-bold text-foreground">{service.name}</p>
                    {service.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{service.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {service.duration_hours ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {service.duration_hours} hours
                        </span>
                      ) : null}
                      {service.max_capacity ? (
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          Up to {service.max_capacity}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1 capitalize">
                        <Package className="h-3.5 w-3.5" />
                        {service.service_category.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 font-bold text-foreground">
                    <DollarSign className="h-4 w-4 text-muted-foreground/60" />
                    {formatPrice(service.base_price)}
                  </div>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
