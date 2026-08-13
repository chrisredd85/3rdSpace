import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// These are the same matchers the Next image endpoint uses before fetching an image.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hasRemoteMatch } = require('next/dist/shared/lib/match-remote-pattern') as {
  hasRemoteMatch: (domains: string[], patterns: unknown[], url: URL) => boolean
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hasLocalMatch } = require('next/dist/shared/lib/match-local-pattern') as {
  hasLocalMatch: (patterns: unknown[], url: string) => boolean
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../next.config.js') as {
  images: { domains?: string[]; remotePatterns: unknown[]; localPatterns: unknown[] }
}

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8')

describe('Next image optimizer trust boundary', () => {
  it('rejects every remote source, including user-controlled Supabase objects', () => {
    expect(nextConfig.images.domains).toBeUndefined()
    expect(nextConfig.images.remotePatterns).toEqual([])

    const userUpload = new URL(
      'https://rxoyebxazqwknlqvpchc.supabase.co/storage/v1/object/public/venue-photos/owned/crafted.tiff'
    )
    expect(hasRemoteMatch([], nextConfig.images.remotePatterns, userUpload)).toBe(false)
  })

  it('allows only the reviewed local hero into the optimizer', () => {
    expect(hasLocalMatch(nextConfig.images.localPatterns, '/lovable/hero-venue.jpg')).toBe(true)
    expect(hasLocalMatch(nextConfig.images.localPatterns, '/api/remote-image-proxy?url=attacker')).toBe(false)
    expect(hasLocalMatch(nextConfig.images.localPatterns, '/uploads/untrusted.png')).toBe(false)
  })

  it('renders every user-controlled venue URL without invoking Next optimization', () => {
    const listing = source('app/(dashboard)/venue/listing/page.tsx')
    const eventVenueStep = source('components/builder/event-wizard/EventVenueStep.tsx')
    const optimizedImage = source('components/shared/OptimizedImage.tsx')

    expect(listing).toMatch(/src=\{photo\.photo_url\}[\s\S]{0,180}\bunoptimized\b/)
    expect(eventVenueStep).toMatch(
      /src=\{\(venue as unknown as \{ photo_url: string \}\)\.photo_url\}[\s\S]{0,180}\bunoptimized\b/
    )
    expect(optimizedImage).toContain(
      "const isRemote = src.startsWith('http://') || src.startsWith('https://')"
    )
    expect(optimizedImage.match(/unoptimized=\{isRemote\}/g)).toHaveLength(2)
  })

  it('routes UI uploads through auth, ownership, magic-byte validation, and canonical storage metadata', () => {
    const hook = source('lib/hooks/useVenuePhotos.ts')
    const route = source('app/api/venue/photos/route.ts')
    const legacyVenueForm = source('components/forms/VenueForm.tsx')
    const storagePolicy = source(
      'supabase/migrations/20260709111000_restrict_venue_photo_uploads_to_server.sql'
    )

    expect(hook).toContain("fetch('/api/venue/photos'")
    expect(hook).not.toContain(".from('venue_photos')")
    expect(hook).not.toContain(".from('venue-photos')")
    expect(legacyVenueForm).not.toContain('bucket="venue-photos"')
    expect(route).toContain('supabase.auth.getUser()')
    expect(route).toContain('venue.owner_id !== userId')
    expect(route).toContain('validateVenuePhotoBytes(bytes)')
    expect(route).toContain('contentType: validated.mimeType')
    expect(route).toContain("`${venue.id}/${randomUUID()}.${validated.extension}`")
    expect(storagePolicy).toContain(
      'drop policy if exists "Venue owners can upload photos" on storage.objects;'
    )
    expect(storagePolicy.match(/drop policy/gi)).toHaveLength(1)
  })
})
