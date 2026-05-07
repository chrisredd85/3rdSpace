import type { ServiceType } from '@/lib/types'

export type TicketPlatform = 'eventbrite' | 'luma' | 'posh' | 'partiful'

export const BUILDER_EVENT_TYPE_OPTIONS = [
  'Concerts',
  'Networking',
  'Pop-ups',
  'Brand activations',
  'Workshops',
  'Community gatherings',
  'Private events',
  'Fundraisers',
] as const

export const TICKET_PLATFORM_OPTIONS: Array<{ id: TicketPlatform; label: string }> = [
  { id: 'eventbrite', label: 'Eventbrite' },
  { id: 'luma', label: 'Luma' },
  { id: 'posh', label: 'Posh' },
  { id: 'partiful', label: 'Partiful' },
]

export const VENUE_AMENITIES = [
  { id: 'wifi', label: 'WiFi', category: 'tech' },
  { id: 'av_equipment', label: 'AV Equipment', category: 'tech' },
  { id: 'projector', label: 'Projector/Screen', category: 'tech' },
  { id: 'sound_system', label: 'Sound System', category: 'tech' },
  { id: 'microphone', label: 'Microphone', category: 'tech' },
  { id: 'kitchen', label: 'Kitchen', category: 'food' },
  { id: 'bar', label: 'Bar', category: 'food' },
  { id: 'outdoor_space', label: 'Outdoor Space', category: 'space' },
  { id: 'stage', label: 'Stage/Platform', category: 'space' },
  { id: 'tables_chairs', label: 'Tables & Chairs', category: 'space' },
  { id: 'parking', label: 'Parking', category: 'access' },
  { id: 'accessibility', label: 'Wheelchair Accessible', category: 'access' },
  { id: 'ac_heating', label: 'AC/Heating', category: 'comfort' },
  { id: 'restrooms', label: 'Restrooms', category: 'comfort' },
  { id: 'security', label: 'Security', category: 'comfort' },
] as const

export const VENUE_AMENITY_CATEGORY_LABELS: Record<string, string> = {
  tech: 'Technology',
  food: 'Food & Beverage',
  space: 'Space Features',
  access: 'Parking & Access',
  comfort: 'Comfort & Facilities',
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  dj: 'DJ / Music',
  catering: 'Caterer',
  bartending: 'Bartender',
  photography: 'Photographer',
  videography: 'Photographer',
  av_tech: 'Audio/Visual Tech',
  event_planning: 'Security / Event Staff',
  florist: 'Decorator / Florist',
  other: 'Security / Event Staff',
}

export const VENUE_AMENITY_LABEL_BY_ID = Object.fromEntries(
  VENUE_AMENITIES.map((amenity) => [amenity.id, amenity.label])
) as Record<string, string>
