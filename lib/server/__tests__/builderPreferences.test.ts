import {
  buildOrganizerPreferencePayload,
  firstKnownBuilderArchetype,
  normalizeBuilderAmenityPreferences,
  normalizeBuilderEventTypes,
} from '@/lib/server/builderPreferences'

describe('builderPreferences', () => {
  it('normalizes creator signup event labels into planner archetype keys', () => {
    expect(normalizeBuilderEventTypes([
      'Networking mixer',
      'Founder/operator dinner',
      'Product launch',
      'Pop-up / activation',
      'Workshop / class',
      'Panel / fireside',
      'Community meetup',
      'Day party / brunch',
      'Nightlife / club night',
      'Listening party / showcase',
      'Community gatherings',
    ])).toEqual([
      'networking_mixer',
      'founder_operator_dinner',
      'brand_product_launch',
      'pop_up_activation',
      'workshop_class',
      'panel_fireside',
      'community_meetup',
      'day_party_brunch_party',
      'nightlife_club_night',
      'listening_party_showcase',
    ])
  })

  it('expands signup amenity labels into searchable venue preference concepts', () => {
    expect(normalizeBuilderAmenityPreferences([
      'Private / semi-private room',
      'AV / microphones',
      'Screen / projector',
      'Kitchen / catering allowed',
    ])).toEqual([
      'private room',
      'semi-private room',
      'av',
      'microphones',
      'screen',
      'projector',
      'kitchen',
      'catering allowed',
    ])
  })

  it('builds a compact organizer preference payload for planner agents', () => {
    const payload = buildOrganizerPreferencePayload({
      builder_id: 'builder-1',
      organization_name: 'Sunset Social Club',
      organization_type: 'Community',
      social_handle: '@sunsetsocial',
      website: 'https://sunsetsocial.example.com',
      bio: 'Recurring founder dinners.',
      event_archetype_keys: ['networking_mixer'],
      event_type_labels: ['Networking mixer'],
      preferred_amenities: ['full bar'],
      preferred_ticket_platforms: ['posh'],
      self_reported_typical_attendance: {
        min: 80,
        max: 120,
      },
    })

    expect(payload).toEqual({
      builder_id: 'builder-1',
      organization_name: 'Sunset Social Club',
      organization_type: 'Community',
      social_handle: '@sunsetsocial',
      website: 'https://sunsetsocial.example.com',
      bio: 'Recurring founder dinners.',
      event_archetype_keys: ['networking_mixer'],
      event_type_labels: ['Networking mixer'],
      preferred_amenities: ['full bar'],
      preferred_ticket_platforms: ['posh'],
      self_reported_typical_attendance: {
        min: 80,
        max: 120,
      },
    })
    expect(firstKnownBuilderArchetype(payload)).toBe('networking_mixer')
  })
})
