import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_VENUE_PHOTO_BYTES,
  VenuePhotoValidationError,
  validateVenuePhotoBytes,
} from '@/lib/security/venue-photo-validation'

const fixture = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath))

function expectRejected(bytes: Buffer, code: VenuePhotoValidationError['code']) {
  try {
    validateVenuePhotoBytes(bytes)
    throw new Error('Expected image validation to reject the bytes')
  } catch (error) {
    expect(error).toBeInstanceOf(VenuePhotoValidationError)
    expect((error as VenuePhotoValidationError).code).toBe(code)
  }
}

describe('venue photo magic-byte validation', () => {
  it('accepts a valid PNG and derives canonical metadata from bytes', () => {
    expect(validateVenuePhotoBytes(fixture('public/favicon-48x48.png'))).toEqual({
      extension: 'png',
      mimeType: 'image/png',
      width: 48,
      height: 48,
    })
  })

  it('accepts a valid JPEG and derives canonical metadata from bytes', () => {
    expect(validateVenuePhotoBytes(fixture('public/lovable/hero-venue.jpg'))).toEqual({
      extension: 'jpg',
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
    })
  })

  it('accepts a valid WebP and derives canonical metadata from bytes', () => {
    const webp = Buffer.from(
      'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=',
      'base64'
    )
    expect(validateVenuePhotoBytes(webp)).toEqual({
      extension: 'webp',
      mimeType: 'image/webp',
      width: 1,
      height: 1,
    })
  })

  it.each([
    ['GIF87a', Buffer.from('GIF87a\x01\x00\x01\x00')],
    ['GIF89a', Buffer.from('GIF89a\x01\x00\x01\x00')],
    ['little-endian TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0])],
    ['big-endian TIFF', Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8])],
    ['VIPS', Buffer.from([0x08, 0xf2, 0xa6, 0xb6, 0, 0, 0, 0])],
    ['SVG', Buffer.from('\uFEFF  <svg xmlns="http://www.w3.org/2000/svg"/>')],
  ])('rejects %s by file signature', (_label, bytes) => {
    expectRejected(bytes, 'unsupported_image_type')
  })

  it('rejects an oversized upload before image parsing', () => {
    expectRejected(Buffer.alloc(MAX_VENUE_PHOTO_BYTES + 1), 'file_too_large')
  })

  it('rejects dimensions over the width/height and pixel limits', () => {
    const png = Buffer.from(fixture('public/favicon-48x48.png'))
    png.writeUInt32BE(4097, 16)
    expectRejected(png, 'image_dimensions_exceeded')

    const tooManyPixels = Buffer.from(fixture('public/favicon-48x48.png'))
    tooManyPixels.writeUInt32BE(4096, 16)
    tooManyPixels.writeUInt32BE(4096, 20)
    expectRejected(tooManyPixels, 'image_dimensions_exceeded')
  })

  it('does not trust a filename or request MIME type when magic bytes are unsupported', () => {
    const fakePngNamedGif = Buffer.from('GIF89a\x01\x00\x01\x00')
    expectRejected(fakePngNamedGif, 'unsupported_image_type')
  })
})
