'use client'

import { AlertTriangle, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface VendorLocationBadgeProps {
  eventCity?: string | null
  vendorCity?: string | null
  neighborhood?: string | null
  formattedAddress?: string | null
  serviceArea?: string | null
  servesEventCity?: boolean | null
  approved?: boolean | null
  specialSupply?: boolean | null
  className?: string
}

export function VendorLocationBadge(props: VendorLocationBadgeProps) {
  const badge = resolveVendorLocationBadge(props)
  if (!badge) return null
  const Icon = badge.tone === 'warning' ? AlertTriangle : MapPin

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-tight',
        badge.tone === 'warning'
          ? 'border-ochre/25 bg-ochre-tint text-ochre'
          : badge.tone === 'special'
            ? 'border-clay/25 bg-clay-tint text-clay'
            : 'border-tan bg-cream-deep text-ink-soft',
        props.className
      )}
      title={badge.label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{badge.label}</span>
    </span>
  )
}

export function resolveVendorLocationBadge({
  eventCity,
  vendorCity,
  neighborhood,
  formattedAddress,
  serviceArea,
  servesEventCity,
  approved,
  specialSupply,
}: VendorLocationBadgeProps): { label: string; tone: 'neutral' | 'warning' | 'special' } | null {
  const city = normalizeCity(vendorCity) ?? cityFromAddress(formattedAddress)
  const event = normalizeCity(eventCity)
  const area = normalizeCity(neighborhood)

  if (!city && !area && !serviceArea) return null
  if (specialSupply) {
    return { label: `${city ?? area ?? 'Bay Area'} - serves Bay Area`, tone: 'special' }
  }

  if (event && city && city === event) {
    if (area && area !== event) return { label: area, tone: 'neutral' }
    return null
  }

  if (event && city && city !== event) {
    if (approved) return { label: `${city} - approved`, tone: 'neutral' }
    if (servesEventCity || serviceAreaMatchesCity(serviceArea, event)) {
      return { label: `${city} - serves ${event}`, tone: 'neutral' }
    }
    return {
      label: `${city} - confirm if you want vendors from outside ${event}`,
      tone: 'warning',
    }
  }

  if (city) return { label: city, tone: 'neutral' }
  if (area) return { label: area, tone: 'neutral' }
  return serviceArea ? { label: serviceArea, tone: 'neutral' } : null
}

function normalizeCity(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function cityFromAddress(value: string | null | undefined) {
  if (!value) return null
  const pieces = value.split(',').map((part) => part.trim()).filter(Boolean)
  if (pieces.length < 2) return null
  const candidate = pieces[pieces.length - 2]
  if (!candidate || /\d/.test(candidate)) return null
  return normalizeCity(candidate)
}

function serviceAreaMatchesCity(serviceArea: string | null | undefined, city: string) {
  return Boolean(serviceArea && new RegExp(`\\b${escapeRegex(city)}\\b`, 'i').test(serviceArea))
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
