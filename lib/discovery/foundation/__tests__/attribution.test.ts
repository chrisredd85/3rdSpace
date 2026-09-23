import { parseGooglePhotoAttribution } from '../attribution'

describe('parseGooglePhotoAttribution', () => {
  it('preserves the individual photo link and every named author profile', () => {
    expect(parseGooglePhotoAttribution({
      name: 'places/fixture/photos/photo-one',
      googleMapsUri: 'https://www.google.com/maps/photo/fixture-one',
      authorAttributions: [
        { displayName: ' Alex Example ', uri: 'https://www.google.com/maps/contrib/alex' },
        { displayName: 'Jordan Example', uri: 'https://maps.google.com/maps/contrib/jordan' },
      ],
    })).toEqual({
      googleMapsUri: 'https://www.google.com/maps/photo/fixture-one',
      authorAttributions: [
        { displayName: 'Alex Example', uri: 'https://www.google.com/maps/contrib/alex' },
        { displayName: 'Jordan Example', uri: 'https://maps.google.com/maps/contrib/jordan' },
      ],
    })
  })

  it('keeps available author fields without inventing missing names, profiles, or photo links', () => {
    expect(parseGooglePhotoAttribution({
      authorAttributions: [
        { displayName: 'Named contributor' },
        { uri: 'https://www.google.com/maps/contrib/profile-only' },
        { displayName: ' ', uri: 'javascript:alert(1)' },
        null,
        [],
        'not an author',
      ],
    })).toEqual({
      googleMapsUri: null,
      authorAttributions: [
        { displayName: 'Named contributor', uri: null },
        { displayName: null, uri: 'https://www.google.com/maps/contrib/profile-only' },
      ],
    })
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://www.google.com/maps/photo/fixture',
    'https:www.google.com/maps/photo/fixture',
    '//www.google.com/maps/photo/fixture',
    '/maps/photo/fixture',
    'https://user:password@www.google.com/maps/photo/fixture',
    'https://www.google.com/\nphoto',
    'https://www.google.com/photo name',
    'https:\\www.google.com\\maps',
    'not a URL',
    12,
    {},
  ])('drops unsafe or malformed links: %s', (uri) => {
    expect(parseGooglePhotoAttribution({
      googleMapsUri: uri,
      authorAttributions: [{ displayName: 'Author stays visible', uri }],
    })).toEqual({
      googleMapsUri: null,
      authorAttributions: [{ displayName: 'Author stays visible', uri: null }],
    })
  })

  it.each([null, undefined, [], 'photo', 3, false])('does not manufacture attribution for %s', (value) => {
    expect(parseGooglePhotoAttribution(value)).toBeNull()
  })

  it.each([undefined, null, 'invalid', {}, 42])('treats a missing or malformed author list as absent', (authors) => {
    expect(parseGooglePhotoAttribution({ authorAttributions: authors })).toEqual({
      googleMapsUri: null,
      authorAttributions: [],
    })
  })

  it('does not borrow a place link when the selected photo lacks its own link', () => {
    const place = {
      googleMapsUri: 'https://www.google.com/maps/place/fixture',
      photos: [{ name: 'places/fixture/photos/one', authorAttributions: [] }],
    }

    expect(parseGooglePhotoAttribution(place.photos[0])?.googleMapsUri).toBeNull()
  })

  it('does not retain the photo resource name, bytes, or unrelated provider fields', () => {
    const photo = Object.freeze({ name: 'places/fixture/photos/one', widthPx: 800, photoUri: 'https://example.com/image' })

    expect(parseGooglePhotoAttribution(photo)).toEqual({ googleMapsUri: null, authorAttributions: [] })
    expect(photo.name).toBe('places/fixture/photos/one')
  })
})
