import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NextRequest } from 'next/server'
import { DELETE, GET, PATCH, POST } from '@/app/api/venue/photos/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('node:crypto', () => ({
  randomUUID: () => '22222222-2222-4222-8222-222222222222',
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const venueId = '11111111-1111-4111-8111-111111111111'
const photoId = '33333333-3333-4333-8333-333333333333'
const userId = 'user-1'

type AdminFixture = ReturnType<typeof makeAdmin>

function bytes(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath))
}

function uploadFile(contents: Buffer) {
  return {
    size: contents.length,
    arrayBuffer: jest.fn(async () => Uint8Array.from(contents).buffer),
  }
}

function requestWith(contents: Buffer) {
  const values = new Map<string, unknown>([
    ['venueId', venueId],
    ['photo', uploadFile(contents)],
  ])
  return {
    formData: jest.fn(async () => ({ get: (name: string) => values.get(name) ?? null })),
  } as unknown as NextRequest
}

function jsonRequest(body: unknown) {
  return {
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest
}

function getRequest(id = venueId) {
  return {
    nextUrl: new URL(`https://www.3rdplace.io/api/venue/photos?venueId=${id}`),
  } as unknown as NextRequest
}

function makeChain(result: unknown) {
  const chain: Record<string, jest.Mock> = {}
  for (const method of ['select', 'eq', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain)
  }
  chain.maybeSingle = jest.fn().mockResolvedValue(result)
  return chain
}

function makeAdmin(options: {
  ownerId?: string
  insertError?: { message: string } | null
  publicUrlError?: Error
} = {}) {
  const venue = makeChain({
    data: { id: venueId, owner_id: options.ownerId ?? userId },
    error: null,
  })
  const order = makeChain({ data: { display_order: 3 }, error: null })
  const insert = jest.fn((payload: Record<string, unknown>) => ({
    select: jest.fn(() => ({
      single: jest.fn().mockResolvedValue(
        options.insertError
          ? { data: null, error: options.insertError }
          : {
              data: {
                id: 'photo-1',
                venue_id: venueId,
                photo_url: payload.photo_url,
                is_primary: false,
                display_order: payload.display_order,
                created_at: '2026-08-12T00:00:00.000Z',
              },
              error: null,
            }
      ),
    })),
  }))

  let venuePhotoReads = 0
  const from = jest.fn((table: string) => {
    if (table === 'venues') return venue
    if (table === 'venue_photos') {
      venuePhotoReads += 1
      return venuePhotoReads === 1 ? order : { insert }
    }
    throw new Error(`Unexpected table ${table}`)
  })

  const upload = jest.fn().mockResolvedValue({ data: { path: 'stored' }, error: null })
  const remove = jest.fn().mockResolvedValue({ data: [], error: null })
  const getPublicUrl = jest.fn(() => {
    if (options.publicUrlError) throw options.publicUrlError
    return {
      data: {
        publicUrl: `https://project.supabase.co/storage/v1/object/public/venue-photos/${venueId}/photo`,
      },
    }
  })
  const storageFrom = jest.fn(() => ({ upload, remove, getPublicUrl }))

  return {
    admin: { from, storage: { from: storageFrom } },
    from,
    insert,
    upload,
    remove,
  }
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('POST /api/venue/photos', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    })
  })

  it('requires an authenticated user before parsing or writing the upload', async () => {
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    })
    const request = requestWith(bytes('public/favicon-48x48.png'))

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(request.formData).not.toHaveBeenCalled()
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('requires explicit venue ownership before storage access', async () => {
    const fixture = makeAdmin({ ownerId: 'different-user' })
    mockCreateServiceRoleClient.mockReturnValue(fixture.admin)

    const response = await POST(requestWith(bytes('public/favicon-48x48.png')))

    expect(response.status).toBe(403)
    expect(fixture.upload).not.toHaveBeenCalled()
    expect(fixture.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['crafted GIF', Buffer.from('GIF89a\x01\x00\x01\x00')],
    ['crafted TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0])],
  ])('rejects %s before any storage or database write', async (_label, contents) => {
    const fixture = makeAdmin()
    mockCreateServiceRoleClient.mockReturnValue(fixture.admin)

    const response = await POST(requestWith(contents))
    const body = await responseJson(response)

    expect(response.status).toBe(400)
    expect(body.code).toBe('unsupported_image_type')
    expect(fixture.upload).not.toHaveBeenCalled()
    expect(fixture.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['PNG', bytes('public/favicon-48x48.png'), 'image/png', 'png'],
    ['JPEG', bytes('public/lovable/hero-venue.jpg'), 'image/jpeg', 'jpg'],
    [
      'WebP',
      Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=', 'base64'),
      'image/webp',
      'webp',
    ],
  ])('accepts valid %s bytes with canonical storage metadata', async (_label, contents, mimeType, extension) => {
    const fixture = makeAdmin()
    mockCreateServiceRoleClient.mockReturnValue(fixture.admin)

    const response = await POST(requestWith(contents))
    const body = await responseJson(response)

    expect(response.status).toBe(201)
    expect(body.photo).toMatchObject({ id: 'photo-1', venue_id: venueId, caption: null })
    expect(fixture.upload).toHaveBeenCalledWith(
      `${venueId}/22222222-2222-4222-8222-222222222222.${extension}`,
      expect.any(Buffer),
      { contentType: mimeType, upsert: false }
    )
    expect(fixture.insert).toHaveBeenCalledWith(
      expect.objectContaining({ venue_id: venueId, display_order: 4 })
    )
  })

  it('removes the stored object if the photo row cannot be saved', async () => {
    const fixture: AdminFixture = makeAdmin({ insertError: { message: 'insert failed' } })
    mockCreateServiceRoleClient.mockReturnValue(fixture.admin)

    const response = await POST(requestWith(bytes('public/favicon-48x48.png')))

    expect(response.status).toBe(500)
    expect(fixture.remove).toHaveBeenCalledWith([
      `${venueId}/22222222-2222-4222-8222-222222222222.png`,
    ])
  })

  it('removes the stored object after any unexpected post-upload failure', async () => {
    const fixture = makeAdmin({ publicUrlError: new Error('interrupted') })
    mockCreateServiceRoleClient.mockReturnValue(fixture.admin)

    const response = await POST(requestWith(bytes('public/favicon-48x48.png')))

    expect(response.status).toBe(500)
    expect(fixture.remove).toHaveBeenCalledWith([
      `${venueId}/22222222-2222-4222-8222-222222222222.png`,
    ])
  })
})

describe('server-owned venue photo management', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
    })
  })

  it('returns owned venue photos despite the table having no browser SELECT policy', async () => {
    const venue = makeChain({ data: { id: venueId, owner_id: userId }, error: null })
    const rows = [{
      id: photoId,
      venue_id: venueId,
      photo_url: 'https://project.supabase.co/photo.png',
      display_order: 0,
      is_primary: true,
      created_at: null,
    }]
    const photos = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: rows, error: null }),
    }
    const admin = {
      from: jest.fn((table: string) => table === 'venues' ? venue : photos),
    }
    mockCreateServiceRoleClient.mockReturnValue(admin)

    const response = await GET(getRequest())
    const body = await responseJson(response)

    expect(response.status).toBe(200)
    expect(body.photos).toEqual([{ ...rows[0], caption: null }])
  })

  it('sets a primary photo only after verifying venue ownership', async () => {
    const photoLookup = makeChain({
      data: { id: photoId, venue_id: venueId },
      error: null,
    })
    const venue = makeChain({ data: { id: venueId, owner_id: userId }, error: null })
    const reset = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    }
    const saved = {
      id: photoId,
      venue_id: venueId,
      photo_url: 'https://project.supabase.co/photo.png',
      display_order: 0,
      is_primary: true,
      created_at: null,
    }
    const update = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: saved, error: null }),
    }
    let photoCalls = 0
    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'venues') return venue
        photoCalls += 1
        return [photoLookup, reset, update][photoCalls - 1]
      }),
    }
    mockCreateServiceRoleClient.mockReturnValue(admin)

    const response = await PATCH(jsonRequest({ photoId, isPrimary: true }))
    const body = await responseJson(response)

    expect(response.status).toBe(200)
    expect(reset.update).toHaveBeenCalledWith({ is_primary: false })
    expect(update.update).toHaveBeenCalledWith({ is_primary: true })
    expect(body.photo).toEqual({ ...saved, caption: null })
  })

  it('deletes an owned row and only its venue-scoped storage object', async () => {
    const photoUrl = `https://project.supabase.co/storage/v1/object/public/venue-photos/${venueId}/photo.png`
    const photoLookup = makeChain({
      data: { id: photoId, venue_id: venueId, photo_url: photoUrl },
      error: null,
    })
    const venue = makeChain({ data: { id: venueId, owner_id: userId }, error: null })
    const deletion = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    }
    const remove = jest.fn().mockResolvedValue({ error: null })
    let photoCalls = 0
    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'venues') return venue
        photoCalls += 1
        return [photoLookup, deletion][photoCalls - 1]
      }),
      storage: { from: jest.fn(() => ({ remove })) },
    }
    mockCreateServiceRoleClient.mockReturnValue(admin)

    const response = await DELETE(jsonRequest({ photoId }))
    const body = await responseJson(response)

    expect(response.status).toBe(200)
    expect(deletion.delete).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith([`${venueId}/photo.png`])
    expect(body).toEqual({ id: photoId, venueId })
  })
})
