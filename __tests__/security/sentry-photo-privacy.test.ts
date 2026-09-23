import type { SpanJSON, TransactionEvent } from '@sentry/core'
import { dropGooglePhotoTelemetry, sentryPhotoPrivacyOptions } from '../../sentry.photo-filter'

const mockInit = jest.fn()
jest.mock('@sentry/nextjs', () => ({ init: (...args: unknown[]) => mockInit(...args) }))

const resource = 'places/test-place/photos/private-photo-token'
const mediaUrl = `https://places.googleapis.com/v1/${resource}/media?maxWidthPx=900`
const imageUrl = 'https://lh3.googleusercontent.com/places/private-image-token'
const independentImage = 'https://example.com/uploads/host-photo.jpg'

function span(overrides: Partial<SpanJSON> = {}): SpanJSON {
  return {
    span_id: '0123456789abcdef',
    trace_id: '0123456789abcdef0123456789abcdef',
    parent_span_id: 'abcdef0123456789',
    start_timestamp: 100,
    timestamp: 101,
    description: 'GET /api/health',
    data: { 'http.request.method': 'GET' },
    ...overrides,
  }
}

describe('Google photo telemetry boundary', () => {
  it.each([
    { exception: { values: [{ value: `Fetch failed: ${mediaUrl}` }] } },
    { extra: { nested: { photo_reference: 'opaque-legacy-token' } } },
    { message: JSON.stringify({ photoName: 'opaque-legacy-token' }) },
    { request: { url: imageUrl } },
    { request: { url: 'https://lh3.googleusercontent.com/a-/opaque-image-token' } },
    { request: { url: 'https://lh3.googleusercontent.com/another-opaque-media-path' } },
    { request: { url: 'https://maps.googleapis.com/maps/api/place/photo?photoreference=legacy-secret' } },
    { extra: { url: `https://example.com/error?upstream=${encodeURIComponent(mediaUrl)}` } },
  ])('drops token-bearing event data before delivery: %j', (event) => {
    expect(dropGooglePhotoTelemetry(event)).toBeNull()
  })

  it('drops automatic fetch breadcrumbs and structured logs containing photo URLs', () => {
    expect(sentryPhotoPrivacyOptions.beforeBreadcrumb({ category: 'fetch', data: { url: mediaUrl } })).toBeNull()
    expect(sentryPhotoPrivacyOptions.beforeSendLog({ message: imageUrl, attributes: {} })).toBeNull()
  })

  it('redacts automatic span descriptions and attributes while preserving trace identity and timing', () => {
    const input = span({ description: `GET ${mediaUrl}`, data: { 'url.full': mediaUrl, 'http.response.header.location': imageUrl } })
    const result = sentryPhotoPrivacyOptions.beforeSendSpan(input)
    expect(result).toEqual({
      span_id: input.span_id,
      trace_id: input.trace_id,
      parent_span_id: input.parent_span_id,
      start_timestamp: 100,
      timestamp: 101,
      description: '[Google photo omitted]',
      data: {},
    })
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(input.description).toContain(mediaUrl)
  })

  it('catches photo URLs in attributes even when the automatic span name omits the URL', () => {
    const result = sentryPhotoPrivacyOptions.beforeSendSpan(span({ data: { 'url.full': imageUrl } }))
    expect(result.data).toEqual({})
    expect(result.description).toBe('[Google photo omitted]')
  })

  it('removes photo spans and breadcrumbs from transaction envelopes without dropping unrelated timing', () => {
    const safeSpan = span()
    const event: TransactionEvent = {
      type: 'transaction',
      transaction: 'GET /planner',
      spans: [safeSpan, span({ description: `GET ${mediaUrl}` })],
      breadcrumbs: [{ message: 'Planner loaded' }, { data: { url: imageUrl } }],
    }
    expect(sentryPhotoPrivacyOptions.beforeSendTransaction(event)).toEqual({
      ...event,
      spans: [safeSpan],
      breadcrumbs: [{ message: 'Planner loaded' }],
    })
    expect(sentryPhotoPrivacyOptions.beforeSendTransaction({ ...event, transaction: mediaUrl })).toBeNull()
  })

  it('preserves independent images, ID-only app endpoints and ordinary telemetry', () => {
    const event = {
      message: 'Image loaded',
      extra: { photos: [{ url: independentImage }] },
      request: { url: 'https://example.com/api/planner/discovery-venues/local-id/photo/0' },
    }
    expect(dropGooglePhotoTelemetry(event)).toBe(event)
    const safeSpan = span({ data: { 'url.full': independentImage } })
    expect(sentryPhotoPrivacyOptions.beforeSendSpan(safeSpan)).toBe(safeSpan)
  })

  it('fails closed for uninspectable telemetry without throwing from the hook', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(dropGooglePhotoTelemetry(circular)).toBeNull()
  })
})

describe('runtime Sentry hook installation', () => {
  const originalServerDsn = process.env.SENTRY_DSN
  const originalBrowserDsn = process.env.NEXT_PUBLIC_SENTRY_DSN

  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://fixture@example.com/1'
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://fixture@example.com/1'
    mockInit.mockClear()
  })

  afterEach(() => {
    if (originalServerDsn === undefined) delete process.env.SENTRY_DSN
    else process.env.SENTRY_DSN = originalServerDsn
    if (originalBrowserDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN
    else process.env.NEXT_PUBLIC_SENTRY_DSN = originalBrowserDsn
  })

  it.each(['server', 'edge', 'client'])('installs photo boundaries in the %s runtime', (runtime) => {
    jest.isolateModules(() => { require(`../../sentry.${runtime}.config`) })
    expect(mockInit).toHaveBeenCalledTimes(1)
    const options = mockInit.mock.calls[0][0]
    for (const hook of ['beforeSend', 'beforeSendTransaction', 'beforeSendSpan', 'beforeBreadcrumb', 'beforeSendLog']) {
      expect(options[hook]).toEqual(expect.any(Function))
    }
    expect(options.beforeSend({ exception: { values: [{ value: mediaUrl }] } }, {})).toBeNull()
    expect(options.beforeSendSpan(span({ description: mediaUrl })).data).toEqual({})
  })

  it('preserves the browser query-string redaction for unrelated errors', () => {
    jest.isolateModules(() => { require('../../sentry.client.config') })
    const options = mockInit.mock.calls[0][0]
    expect(options.beforeSend({ request: { url: 'https://example.com/planner?private=value' } }, {}))
      .toEqual({ request: { url: 'https://example.com/planner' } })
  })
})
