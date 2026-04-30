'use client'

import { Camera, Clock, DollarSign, Package, Pencil, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { getServiceCategoryLabel } from '@/lib/vendor-services/service-options'
import type { VendorService } from '@/lib/vendor-services/types'

interface ServiceCardProps {
  service: VendorService
  onEdit?: (service: VendorService) => void
  onDelete?: (service: VendorService) => void
  compact?: boolean
}

/**
 * Formats a service price for display.
 *
 * @param amount - Dollar amount.
 * @returns Currency string.
 */
function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Converts a stored portfolio image path into a public URL.
 *
 * @param path - Storage object path or already-public URL.
 * @returns Public image URL.
 */
function getImageUrl(path: string) {
  if (path.startsWith('http')) return path
  return supabase.storage.from('vendor-photos').getPublicUrl(path).data.publicUrl
}

/**
 * Displays a vendor service listing for profiles and manager screens.
 *
 * @param props - Service row and optional edit/delete handlers.
 * @returns Service card UI.
 */
export function ServiceCard({ service, onEdit, onDelete, compact = false }: ServiceCardProps) {
  const coverImage = service.portfolio_images[0]

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="aspect-[16/9] bg-sidebar-accent/40">
        {coverImage ? (
          <div
            role="img"
            aria-label={`${service.offering_name} portfolio`}
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${getImageUrl(coverImage)})` }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground/60">
            <Camera className="h-8 w-8" />
          </div>
        )}
      </div>

      <div className={compact ? 'space-y-3 p-4' : 'space-y-4 p-5'}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {getServiceCategoryLabel(service.service_category)}
            </p>
            <h3 className="mt-1 text-lg font-bold text-foreground">{service.offering_name}</h3>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-foreground">{formatCurrency(service.base_price)}</p>
            <p className="text-xs text-muted-foreground">base price</p>
          </div>
        </div>

        {service.description ? (
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{service.description}</p>
        ) : null}

        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          {service.duration_hours ? (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground/60" />
              {service.duration_hours >= 12 ? 'All-day' : `${service.duration_hours} hours`}
            </div>
          ) : null}
          {service.max_capacity ? (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground/60" />
              Up to {service.max_capacity}
            </div>
          ) : null}
          {service.add_ons.length > 0 ? (
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground/60" />
              {service.add_ons.length} add-on{service.add_ons.length === 1 ? '' : 's'}
            </div>
          ) : null}
          {service.equipment_included.length > 0 ? (
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground/60" />
              {service.equipment_included.length} included
            </div>
          ) : null}
        </div>

        {service.equipment_included.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {service.equipment_included.slice(0, 5).map((item) => (
              <span key={item} className="rounded-md bg-sidebar-accent/40 px-2 py-1 text-xs font-medium text-foreground">
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {(onEdit || onDelete) ? (
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            {onEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onEdit(service)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            ) : null}
            {onDelete ? (
              <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(service)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
