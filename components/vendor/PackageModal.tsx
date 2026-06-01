'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateVendorPackage,
  useUpdateVendorPackage,
} from '@/lib/hooks/useVendorPackages'
import { useToast } from '@/components/ui/toast'
import type { VendorPackage } from '@/lib/types'

interface PackageModalProps {
  package?: VendorPackage | null
  vendorId: string | null
  onClose: () => void
  onSuccess?: () => void
}

const commonInclusions = [
  'Setup & Breakdown',
  'Sound System',
  'Microphones',
  'Lighting',
  'Backup Equipment',
  'Travel within Service Area',
  'Event Coordination',
]

export function PackageModal({
  package: pkg,
  vendorId,
  onClose,
  onSuccess,
}: PackageModalProps) {
  const { addToast } = useToast()
  const createPackage = useCreateVendorPackage()
  const updatePackage = useUpdateVendorPackage()

  const isEditing = !!pkg

  const [name, setName] = useState(pkg?.package_name || '')
  const [description, setDescription] = useState(pkg?.description || '')
  const [price, setPrice] = useState(pkg?.base_price?.toString() || '')
  const [duration, setDuration] = useState(pkg?.duration_hours?.toString() || '')
  const [selectedInclusions, setSelectedInclusions] = useState<string[]>(
    pkg?.includes || []
  )
  const [customInclusions, setCustomInclusions] = useState<string[]>([])
  const [isActive, setIsActive] = useState(pkg?.is_active ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})

    // Validation
    if (!name.trim()) {
      setErrors({ name: 'Package name is required' })
      return
    }
    if (!price || parseFloat(price) <= 0) {
      setErrors({ price: 'Valid price is required' })
      return
    }
    if (!duration || parseFloat(duration) <= 0) {
      setErrors({ duration: 'Valid duration is required' })
      return
    }
    if (!vendorId) {
      addToast({
        title: 'Error',
        description: 'Vendor ID is required',
        variant: 'destructive',
      })
      return
    }

    try {
      const inclusions = [...selectedInclusions, ...customInclusions.filter((i) => i.trim())]
      const packageData = {
        vendor_id: vendorId,
        package_name: name.trim(),
        description: description.trim() || null,
        base_price: parseFloat(price),
        duration_hours: parseFloat(duration),
        includes: inclusions,
        is_active: isActive,
      }

      if (isEditing && pkg) {
        await updatePackage.mutateAsync({
          id: pkg.id,
          updates: packageData,
        })
        addToast({
          title: 'Package updated',
          description: 'The package has been updated successfully.',
        })
      } else {
        await createPackage.mutateAsync(packageData as any)
        addToast({
          title: 'Package created',
          description: 'The package has been added successfully.',
        })
      }

      onSuccess?.()
      onClose()
    } catch (error) {
      addToast({
        title: 'Error',
        description: isEditing ? 'Failed to update package' : 'Failed to create package',
        variant: 'destructive',
      })
    }
  }

  const handleAddCustomInclusion = () => {
    setCustomInclusions([...customInclusions, ''])
  }

  const handleUpdateCustomInclusion = (index: number, value: string) => {
    const updated = [...customInclusions]
    updated[index] = value
    setCustomInclusions(updated)
  }

  const handleRemoveCustomInclusion = (index: number) => {
    setCustomInclusions(customInclusions.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{isEditing ? 'Edit Package' : 'Create Package'}</CardTitle>
              <CardDescription>
                {isEditing
                  ? 'Update package details and pricing'
                  : 'Add a new service package'}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Package Name *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Premium DJ Package"
                className={errors.name ? 'border-brick' : ''}
              />
              {errors.name && (
                <p className="text-sm text-brick mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Describe what's included in this package..."
                className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Price ($) *
                </label>
                <Input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="1500"
                  className={errors.price ? 'border-brick' : ''}
                />
                {errors.price && (
                  <p className="text-sm text-brick mt-1">{errors.price}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium text-ink mb-2 block">
                  Duration (hours) *
                </label>
                <Input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="4"
                  className={errors.duration ? 'border-brick' : ''}
                />
                {errors.duration && (
                  <p className="text-sm text-brick mt-1">{errors.duration}</p>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-ink mb-2 block">
                Inclusions
              </label>
              <div className="space-y-2">
                {commonInclusions.map((inclusion) => (
                  <label
                    key={inclusion}
                    className="flex items-center gap-2 p-2 border border-tan rounded hover:bg-cream cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedInclusions.includes(inclusion)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedInclusions([...selectedInclusions, inclusion])
                        } else {
                          setSelectedInclusions(
                            selectedInclusions.filter((i) => i !== inclusion)
                          )
                        }
                      }}
                      className="h-4 w-4 text-clay"
                    />
                    <span className="text-sm text-ink">{inclusion}</span>
                  </label>
                ))}

                {customInclusions.map((inclusion, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={inclusion}
                      onChange={(e) => handleUpdateCustomInclusion(index, e.target.value)}
                      placeholder="Custom inclusion"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveCustomInclusion(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddCustomInclusion}
                  className="w-full"
                >
                  <X className="h-4 w-4 mr-2 rotate-45" />
                  Add Custom Inclusion
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 text-clay"
              />
              <label htmlFor="isActive" className="text-sm font-medium text-ink">
                Package is active (visible to clients)
              </label>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1"
                disabled={createPackage.isPending || updatePackage.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={createPackage.isPending || updatePackage.isPending}
              >
                {createPackage.isPending || updatePackage.isPending
                  ? 'Saving...'
                  : isEditing
                  ? 'Update Package'
                  : 'Create Package'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
