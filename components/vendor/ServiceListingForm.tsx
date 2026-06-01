'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SERVICE_DURATION_OPTIONS, VENDOR_SERVICE_CATEGORIES } from '@/lib/vendor-services/service-options'
import type { VendorService, VendorServiceAddOn } from '@/lib/vendor-services/types'

interface ServiceListingFormProps {
  vendorId: string
  service?: VendorService | null
  onSaved: () => void
  onCancel: () => void
}

/**
 * Converts an array into a newline-separated textarea value.
 *
 * @param values - String values.
 * @returns Textarea value.
 */
function toLines(values?: string[]) {
  return (values || []).join('\n')
}

/**
 * Converts newline text into trimmed string values.
 *
 * @param value - Textarea value.
 * @returns Non-empty lines.
 */
function fromLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Creates an empty add-on row for editing.
 *
 * @returns Empty add-on.
 */
function createEmptyAddOn(): VendorServiceAddOn {
  return { name: '', price: 0, description: '' }
}

/**
 * Form for creating and editing vendor service listings.
 *
 * @param props - Vendor id, optional service, save callback, and cancel callback.
 * @returns Service listing form.
 */
export function ServiceListingForm({ vendorId, service, onSaved, onCancel }: ServiceListingFormProps) {
  const [offeringName, setOfferingName] = useState(service?.offering_name || '')
  const [description, setDescription] = useState(service?.description || '')
  const [basePrice, setBasePrice] = useState(String(service?.base_price ?? ''))
  const [durationHours, setDurationHours] = useState(String(service?.duration_hours ?? 4))
  const [serviceCategory, setServiceCategory] = useState(service?.service_category || 'dj')
  const [maxCapacity, setMaxCapacity] = useState(String(service?.max_capacity ?? ''))
  const [equipmentText, setEquipmentText] = useState(toLines(service?.equipment_included))
  const [addOns, setAddOns] = useState<VendorServiceAddOn[]>(service?.add_ons.length ? service.add_ons : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = Boolean(service?.id)
  const validAddOns = useMemo(
    () => addOns.filter((addOn) => addOn.name.trim()),
    [addOns]
  )

  /**
   * Saves the service listing through the vendor services API.
   */
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const payload = {
        vendorId,
        offering_name: offeringName,
        description,
        base_price: Number(basePrice || 0),
        duration_hours: Number(durationHours || 0),
        service_category: serviceCategory,
        max_capacity: maxCapacity ? Number(maxCapacity) : null,
        equipment_included: fromLines(equipmentText),
        add_ons: validAddOns.map((addOn) => ({
          name: addOn.name.trim(),
          price: Number(addOn.price || 0),
          description: addOn.description?.trim() || '',
        })),
        is_active: true,
      }

      const response = await fetch(isEditing ? `/api/vendor/services/${service?.id}` : '/api/vendor/services', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save service')
      }

      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save service')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-tan bg-cream p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Service Name *</label>
          <Input value={offeringName} onChange={(event) => setOfferingName(event.target.value)} placeholder="Wedding DJ Package" required />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Category *</label>
          <select
            value={serviceCategory}
            onChange={(event) => setServiceCategory(event.target.value as typeof serviceCategory)}
            className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
          >
            {VENDOR_SERVICE_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>{category.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-ink">Description</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
          placeholder="Describe the experience, ideal event type, and deliverables."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Base Price *</label>
          <Input type="number" min={0} step="25" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} placeholder="1200" required />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Duration</label>
          <select
            value={durationHours}
            onChange={(event) => setDurationHours(event.target.value)}
            className="flex h-10 w-full rounded-md border border-tan px-3 py-2 text-sm"
          >
            {SERVICE_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink">Max Capacity</label>
          <Input type="number" min={1} value={maxCapacity} onChange={(event) => setMaxCapacity(event.target.value)} placeholder="250" />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-ink">Equipment / Deliverables Included</label>
        <textarea
          value={equipmentText}
          onChange={(event) => setEquipmentText(event.target.value)}
          rows={4}
          className="w-full rounded-md border border-tan px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-clay"
          placeholder={'Two wireless microphones\nSound system\nSetup and teardown\nEdited photo gallery'}
        />
        <p className="mt-1 text-xs text-ink-soft">One item per line.</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium text-ink">Optional Add-ons</label>
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOns((current) => [...current, createEmptyAddOn()])}>
            <Plus className="mr-2 h-4 w-4" />
            Add-on
          </Button>
        </div>

        {addOns.map((addOn, index) => (
          <div key={index} className="grid gap-3 rounded-md border border-tan bg-cream/40 p-3 md:grid-cols-[1fr_120px_1fr_auto]">
            <Input
              value={addOn.name}
              onChange={(event) => setAddOns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
              placeholder="Extra hour"
            />
            <Input
              type="number"
              min={0}
              value={addOn.price}
              onChange={(event) => setAddOns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, price: Number(event.target.value || 0) } : item))}
              placeholder="250"
            />
            <Input
              value={addOn.description || ''}
              onChange={(event) => setAddOns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}
              placeholder="Optional note"
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => setAddOns((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-brick">{error}</p> : null}

      <div className="flex justify-end gap-2 border-t border-tan pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : isEditing ? 'Save Service' : 'Create Service'}</Button>
      </div>
    </form>
  )
}

