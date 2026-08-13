export const MAX_VENUE_PHOTO_BYTES = 4 * 1024 * 1024
export const MAX_VENUE_PHOTO_DIMENSION = 4096
export const MAX_VENUE_PHOTO_PIXELS = 16_000_000

export type ValidatedVenuePhoto = {
  extension: 'jpg' | 'png' | 'webp'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
}

export type VenuePhotoValidationCode =
  | 'empty_file'
  | 'file_too_large'
  | 'unsupported_image_type'
  | 'invalid_image'
  | 'image_dimensions_exceeded'

export class VenuePhotoValidationError extends Error {
  constructor(
    public readonly code: VenuePhotoValidationCode,
    message: string
  ) {
    super(message)
    this.name = 'VenuePhotoValidationError'
  }
}

function fail(code: VenuePhotoValidationCode, message: string): never {
  throw new VenuePhotoValidationError(code, message)
}

function hasBytes(bytes: Buffer, offset: number, expected: readonly number[]) {
  if (offset + expected.length > bytes.length) return false
  return expected.every((value, index) => bytes[offset + index] === value)
}

function readPngDimensions(bytes: Buffer) {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!hasBytes(bytes, 0, pngSignature)) return null

  if (
    bytes.length < 24 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    fail('invalid_image', 'The PNG header is malformed.')
  }

  return {
    extension: 'png' as const,
    mimeType: 'image/png' as const,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function readJpegDimensions(bytes: Buffer) {
  if (!hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return null

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ])

  let offset = 2
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break

    const marker = bytes[offset]
    offset += 1

    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) {
      fail('invalid_image', 'The JPEG header is truncated.')
    }

    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      fail('invalid_image', 'The JPEG segment table is malformed.')
    }

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) {
        fail('invalid_image', 'The JPEG dimensions are malformed.')
      }

      return {
        extension: 'jpg' as const,
        mimeType: 'image/jpeg' as const,
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      }
    }

    offset += segmentLength
  }

  fail('invalid_image', 'The JPEG does not contain readable dimensions.')
}

function readWebpDimensions(bytes: Buffer) {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null
  }

  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.subarray(offset, offset + 4).toString('ascii')
    const chunkLength = bytes.readUInt32LE(offset + 4)
    const dataOffset = offset + 8

    if (dataOffset + chunkLength > bytes.length) {
      fail('invalid_image', 'The WebP chunk table is malformed.')
    }

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) fail('invalid_image', 'The WebP header is truncated.')
      return {
        extension: 'webp' as const,
        mimeType: 'image/webp' as const,
        width: 1 + bytes.readUIntLE(dataOffset + 4, 3),
        height: 1 + bytes.readUIntLE(dataOffset + 7, 3),
      }
    }

    if (chunkType === 'VP8L') {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) {
        fail('invalid_image', 'The lossless WebP header is malformed.')
      }
      const packed = bytes.readUInt32LE(dataOffset + 1)
      return {
        extension: 'webp' as const,
        mimeType: 'image/webp' as const,
        width: 1 + (packed & 0x3fff),
        height: 1 + ((packed >>> 14) & 0x3fff),
      }
    }

    if (chunkType === 'VP8 ') {
      if (
        chunkLength < 10 ||
        !hasBytes(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])
      ) {
        fail('invalid_image', 'The lossy WebP header is malformed.')
      }
      return {
        extension: 'webp' as const,
        mimeType: 'image/webp' as const,
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      }
    }

    offset = dataOffset + chunkLength + (chunkLength % 2)
  }

  fail('invalid_image', 'The WebP does not contain readable dimensions.')
}

function isExplicitlyForbidden(bytes: Buffer) {
  const prefix = bytes.subarray(0, Math.min(bytes.length, 512))
  const textPrefix = prefix
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase()

  const isGif =
    prefix.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    prefix.subarray(0, 6).toString('ascii') === 'GIF89a'
  const isTiff =
    hasBytes(prefix, 0, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBytes(prefix, 0, [0x4d, 0x4d, 0x00, 0x2a]) ||
    hasBytes(prefix, 0, [0x49, 0x49, 0x2b, 0x00]) ||
    hasBytes(prefix, 0, [0x4d, 0x4d, 0x00, 0x2b])
  const isVips =
    hasBytes(prefix, 0, [0x08, 0xf2, 0xa6, 0xb6]) ||
    hasBytes(prefix, 0, [0xb6, 0xa6, 0xf2, 0x08])
  const isSvg =
    textPrefix.startsWith('<svg') ||
    textPrefix.startsWith('<!doctype svg') ||
    (textPrefix.startsWith('<?xml') && textPrefix.includes('<svg'))

  return isGif || isTiff || isVips || isSvg
}

export function validateVenuePhotoBytes(
  input: Buffer | Uint8Array
): ValidatedVenuePhoto {
  const bytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength)

  if (bytes.length === 0) fail('empty_file', 'The photo file is empty.')
  if (bytes.length > MAX_VENUE_PHOTO_BYTES) {
    fail('file_too_large', 'Venue photos must be 4 MB or smaller.')
  }
  if (isExplicitlyForbidden(bytes)) {
    fail('unsupported_image_type', 'Only PNG, JPEG, and WebP venue photos are allowed.')
  }

  const photo =
    readPngDimensions(bytes) ??
    readJpegDimensions(bytes) ??
    readWebpDimensions(bytes)

  if (!photo) {
    fail('unsupported_image_type', 'Only PNG, JPEG, and WebP venue photos are allowed.')
  }

  if (
    photo.width <= 0 ||
    photo.height <= 0 ||
    photo.width > MAX_VENUE_PHOTO_DIMENSION ||
    photo.height > MAX_VENUE_PHOTO_DIMENSION ||
    photo.width * photo.height > MAX_VENUE_PHOTO_PIXELS
  ) {
    fail(
      'image_dimensions_exceeded',
      'Venue photos must be at most 4096 by 4096 pixels and 16 megapixels.'
    )
  }

  return photo
}
