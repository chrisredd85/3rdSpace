import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GoogleVenueCardDetails } from '../GoogleVenueCardDetails'

const originalFetch = global.fetch
const originalObserver = global.IntersectionObserver
let reveal: () => void
const fetchMock = jest.fn()
const response = { venue_id: 'venue-one', google_live: { status: 'available', place_id: 'place-one', profile: 'pro', attempts: 1, place: { id: 'place-one', displayName: { text: 'Live name' }, formattedAddress: 'Live address', googleMapsUri: 'https://maps.google.com/place-one', attributions: [{ provider: 'Third party', providerUri: '//example.com/source' }] } } }
beforeEach(() => {
  jest.clearAllMocks(); global.fetch = fetchMock
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => response })
  global.IntersectionObserver = jest.fn((callback: IntersectionObserverCallback) => {
    reveal = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    return { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn(), takeRecords: jest.fn() }
  }) as unknown as typeof IntersectionObserver
})
afterAll(() => { global.fetch = originalFetch; global.IntersectionObserver = originalObserver })

it('hydrates only when visible and keeps live content out of browser storage', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem')
  render(<GoogleVenueCardDetails venueId="venue-one" />)
  expect(fetchMock).not.toHaveBeenCalled()
  await act(async () => reveal())
  expect(await screen.findByText('Live name')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/planner/discovery-venues/venue-one/card', expect.objectContaining({ cache: 'no-store' }))
  expect(screen.getByAltText('Google Maps')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View on Google Maps' })).toHaveAttribute('href', 'https://maps.google.com/place-one')
  expect(screen.getByRole('link', { name: 'Third party' })).toHaveAttribute('href', 'https://example.com/source')
  expect(storage).not.toHaveBeenCalled(); storage.mockRestore()
})
it('keeps independent actions usable when optional hydration fails', async () => {
  const approve = jest.fn(); fetchMock.mockRejectedValue(new Error('Unavailable'))
  render(<><GoogleVenueCardDetails venueId="venue-one" /><button onClick={approve}>Review independent quote</button></>)
  await act(async () => reveal())
  expect(screen.getByText('Live venue details unavailable')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Review independent quote'))
  expect(approve).toHaveBeenCalledTimes(1)
})
it('discards a delayed response after unmount and rejects a different returned identity', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...response, venue_id: 'wrong' }) })
  const rendered = render(<GoogleVenueCardDetails venueId="venue-one" />)
  await act(async () => reveal())
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Live name')).not.toBeInTheDocument()
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
  rendered.unmount(); expect(signal.aborted).toBe(true)
})
