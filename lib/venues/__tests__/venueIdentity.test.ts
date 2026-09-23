import { dedupeVenueIdentity } from '../venueIdentity'

it('preserves distinct native UUIDs under a shared Place ID without inventing room identities', () => {
  const rows = [
    { id: 'room-one', venue_identity_kind: 'catalog', google_place_id: 'parent', venue_name: 'Same' },
    { id: 'room-two', venue_identity_kind: 'catalog', google_place_id: 'parent', venue_name: 'Same' },
  ]
  expect(dedupeVenueIdentity(rows)).toEqual(rows)
})

it('keeps explicit rooms and distinct businesses and chooses the catalog row for a claimed alias in either order', () => {
  const alias = { id: 'discovery', claimed_venue_id: 'catalog', venue_identity_kind: 'discovery', google_place_id: 'parent' }
  const catalog = { id: 'catalog', venue_identity_kind: 'catalog', google_place_id: 'parent', room_id: 'small', hourly_rate_cents: 25000 }
  for (const rows of [[alias, catalog], [catalog, alias]]) expect(dedupeVenueIdentity(rows)).toEqual([catalog])
  expect(dedupeVenueIdentity([
    { id: 'a', google_place_id: 'parent', room_id: 'small' },
    { id: 'b', google_place_id: 'parent', room_id: 'large' },
    { id: 'c', google_place_id: 'other', venue_name: 'Same' },
    { id: 'd', google_place_id: 'places/other', venue_name: 'Renamed' },
  ]).map(row => row.id)).toEqual(['a', 'b', 'c'])
})
