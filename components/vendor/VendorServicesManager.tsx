'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ServiceCard } from '@/components/vendor/ServiceCard'
import { ServiceListingForm } from '@/components/vendor/ServiceListingForm'
import { PortfolioUploader } from '@/components/vendor/PortfolioUploader'
import type { VendorService } from '@/lib/vendor-services/types'

interface VendorServicesManagerProps {
  vendorId: string
}

/**
 * Manages CRUD operations and portfolio uploads for all vendor services.
 *
 * @param props - Vendor profile id.
 * @returns Vendor service manager UI.
 */
export function VendorServicesManager({ vendorId }: VendorServicesManagerProps) {
  const [services, setServices] = useState<VendorService[]>([])
  const [editingService, setEditingService] = useState<VendorService | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * Loads service listings for the vendor.
   */
  const loadServices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/vendor/services?vendorId=${vendorId}`, {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load services')
      }

      setServices(data.services || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load services')
    } finally {
      setLoading(false)
    }
  }, [vendorId])

  useEffect(() => {
    loadServices()
  }, [loadServices])

  /**
   * Deletes a service listing after confirmation.
   *
   * @param service - Service to delete.
   */
  async function handleDelete(service: VendorService) {
    if (!window.confirm(`Delete ${service.offering_name}? This removes its portfolio photos too.`)) return

    const response = await fetch(`/api/vendor/services/${service.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    const data = await response.json()

    if (!response.ok) {
      setError(data.error || 'Failed to delete service')
      return
    }

    await loadServices()
  }

  /**
   * Clears forms and reloads services after create/edit actions.
   */
  async function handleSaved() {
    setShowCreateForm(false)
    setEditingService(null)
    await loadServices()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Service Listings</h2>
          <p className="text-sm text-ink-soft">Create bookable services with pricing, deliverables, add-ons, and portfolio photos.</p>
        </div>
        <Button type="button" onClick={() => {
          setEditingService(null)
          setShowCreateForm(true)
        }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Service
        </Button>
      </div>

      {showCreateForm ? (
        <ServiceListingForm
          vendorId={vendorId}
          onSaved={handleSaved}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : null}

      {editingService ? (
        <ServiceListingForm
          vendorId={vendorId}
          service={editingService}
          onSaved={handleSaved}
          onCancel={() => setEditingService(null)}
        />
      ) : null}

      {error ? <div className="rounded-md border border-brick/30 bg-brick/10 p-3 text-sm text-brick">{error}</div> : null}

      {loading ? (
        <div className="rounded-lg border border-tan p-6 text-center text-sm text-ink-soft">Loading services...</div>
      ) : services.length === 0 ? (
        <div className="rounded-lg border border-dashed border-tan p-8 text-center">
          <p className="font-semibold text-ink">No service listings yet</p>
          <p className="mt-1 text-sm text-ink-soft">Add your first package or service so builders can understand what you offer.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {services.map((service) => (
            <div key={service.id} className="space-y-3">
              <ServiceCard service={service} onEdit={setEditingService} onDelete={handleDelete} />
              <PortfolioUploader
                serviceId={service.id}
                images={Array.isArray(service.portfolio_images) ? service.portfolio_images : []}
                onUploaded={loadServices}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
