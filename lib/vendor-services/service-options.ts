export const VENDOR_SERVICE_CATEGORIES = [
  { value: 'dj', label: 'DJ' },
  { value: 'photography', label: 'Photography' },
  { value: 'videography', label: 'Videography' },
  { value: 'av', label: 'AV' },
  { value: 'security', label: 'Security' },
  { value: 'catering', label: 'Catering' },
  { value: 'bartending', label: 'Bartending' },
  { value: 'staffing', label: 'Staffing' },
  { value: 'production', label: 'Production' },
  { value: 'decor', label: 'Decor' },
  { value: 'other', label: 'Other' },
] as const

export const SERVICE_DURATION_OPTIONS = [
  { value: 4, label: '4 hours' },
  { value: 8, label: '8 hours' },
  { value: 12, label: 'All-day' },
] as const

export type VendorServiceCategory = (typeof VENDOR_SERVICE_CATEGORIES)[number]['value']

/**
 * Gets a human-readable label for a service category value.
 *
 * @param value - Stored service category.
 * @returns Display label for UI cards and forms.
 */
export function getServiceCategoryLabel(value?: string | null) {
  return VENDOR_SERVICE_CATEGORIES.find((category) => category.value === value)?.label || 'Other'
}

