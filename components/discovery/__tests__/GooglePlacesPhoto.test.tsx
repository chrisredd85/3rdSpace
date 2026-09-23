import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GooglePlacesPhoto } from '../GooglePlacesPhoto'
import type { GooglePhotoEntityType } from '@/lib/discovery/googlePhoto'

const entityId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const dataUrl = 'data:image/jpeg;base64,/9j/2Q=='

function photo(entityType: GooglePhotoEntityType = 'discovery_venue', id = entityId, author = 'Alex Example') {
  return {
    dataUrl,
    entityType,
    entityId: id,
    index: 0,
    attribution: {
      googleMapsUri: `https://www.google.com/maps/photo/${id}`,
      authorAttributions: [
        { displayName: author, uri: '//www.google.com/maps/contrib/alex', photoUri: '//lh3.googleusercontent.com/avatar' },
        { displayName: 'Jordan Example', uri: 'https://www.google.com/maps/contrib/jordan' },
      ],
    },
  }
}

function jsonResponse(value: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value } as Response
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('GooglePlacesPhoto', () => {
  beforeEach(() => { jest.clearAllMocks() })
  afterEach(() => { jest.restoreAllMocks() })

  it.each(['discovery_venue', 'discovery_vendor'] as const)('loads %s image and all matching credits only on explicit interaction without storage', async (entityType) => {
    const user = userEvent.setup()
    const storage = jest.spyOn(Storage.prototype, 'setItem')
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(photo(entityType)))
    global.fetch = fetchMock
    render(<GooglePlacesPhoto entityType={entityType} entityId={entityId} alt="Example partner" />)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View photo of Example partner' }))
    const image = await screen.findByRole('img', { name: 'Example partner' })
    expect(image).toHaveAttribute('src', dataUrl)
    const figure = within(image.closest('figure')!)
    expect(image.closest('[data-sentry-block]')).not.toBeNull()
    expect(figure.getByRole('link', { name: 'Alex Example' })).toHaveAttribute('href', 'https://www.google.com/maps/contrib/alex')
    expect(figure.getByRole('link', { name: 'Jordan Example' })).toBeVisible()
    expect(figure.getByRole('link', { name: 'View photo on Google Maps' })).toHaveAttribute('href', photo().attribution.googleMapsUri)
    expect(figure.getByRole('img', { name: 'Google Maps' })).toBeVisible()
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`/api/planner/${entityType === 'discovery_venue' ? 'discovery-venues' : 'discovery-vendors'}/${entityId}/photo/0`, {
      cache: 'no-store', signal: expect.any(AbortSignal),
    })
    expect(storage).not.toHaveBeenCalled()
  })

  it('releases image and credit together on hide, then fetches a fresh pair on reopen', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse(photo()))
      .mockResolvedValueOnce(jsonResponse({ ...photo('discovery_venue', entityId, 'Fresh author'), dataUrl: 'data:image/png;base64,AQID' }))
    render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    await screen.findByRole('img', { name: 'Venue' })
    await user.click(screen.getByRole('button', { name: 'Hide photo of Venue' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Google Maps attribution')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    expect(await screen.findByRole('link', { name: 'Fresh author' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Venue' })).toHaveAttribute('src', 'data:image/png;base64,AQID')
    expect(screen.queryByRole('link', { name: 'Alex Example' })).not.toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not show an old request after the entity changes, even when fetch ignores abort', async () => {
    const user = userEvent.setup()
    const oldRequest = deferred<Response>()
    const fetchMock = jest.fn().mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(jsonResponse(photo('discovery_venue', secondId, 'New venue author')))
    global.fetch = fetchMock
    const { rerender } = render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Old venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Old venue' }))
    rerender(<GooglePlacesPhoto entityType="discovery_venue" entityId={secondId} alt="New venue" />)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await user.click(screen.getByRole('button', { name: 'View photo of New venue' }))
    await screen.findByRole('link', { name: 'New venue author' })
    await act(async () => oldRequest.resolve(jsonResponse(photo())))
    expect(screen.getByRole('img', { name: 'New venue' })).toHaveAttribute('src', dataUrl)
    expect(screen.queryByRole('link', { name: 'Alex Example' })).not.toBeInTheDocument()
  })

  it('aborts on hide and unmount and cannot restore a hidden photo from a late response', async () => {
    const user = userEvent.setup()
    const request = deferred<Response>()
    const fetchMock = jest.fn().mockReturnValue(request.promise)
    global.fetch = fetchMock
    const { unmount } = render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    await user.click(screen.getByRole('button', { name: 'Hide photo of Venue' }))
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => request.resolve(jsonResponse(photo())))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    unmount()
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true)
  })

  it.each([204, 404, 503])('hides gracefully for status %i, without reading legacy photo data', async (status) => {
    const user = userEvent.setup()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ photos: [{ name: 'places/legacy/photos/old' }] }, status))
    const { container } = render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...photo(), entityId: secondId },
    { ...photo(), index: 1 },
    { ...photo(), entityType: 'discovery_vendor' },
    { ...photo(), attribution: { googleMapsUri: null, authorAttributions: [] } },
    { ...photo(), attribution: { googleMapsUri: 'javascript:alert(1)', authorAttributions: [] } },
    { ...photo(), dataUrl: 'https://example.com/legacy.jpg' },
    { ...photo(), dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...photo(), attribution: { ...photo().attribution, authorAttributions: [null] } },
    { ...photo(), attribution: { ...photo().attribution, authorAttributions: [{ displayName: 'Missing profile' }] } },
    { ...photo(), attribution: { ...photo().attribution, authorAttributions: [{ uri: 'https://www.google.com/maps/contrib/alex' }] } },
  ])('hides an invalid or mismatched response without fallback', async (response) => {
    const user = userEvent.setup()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(response))
    const { container } = render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('removes both photo and attribution after an image decoding failure', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(photo()))
    const { container } = render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    fireEvent.error(await screen.findByRole('img', { name: 'Venue' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('accepts AVIF media with an empty, explicitly supplied author list', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({
      ...photo(), dataUrl: 'data:image/avif;base64,YXZpZg==',
      attribution: { ...photo().attribution, authorAttributions: [] },
    }))
    render(<GooglePlacesPhoto entityType="discovery_venue" entityId={entityId} alt="Venue" />)
    await user.click(screen.getByRole('button', { name: 'View photo of Venue' }))
    expect(await screen.findByRole('img', { name: 'Venue' })).toHaveAttribute('src', 'data:image/avif;base64,YXZpZg==')
  })
})
