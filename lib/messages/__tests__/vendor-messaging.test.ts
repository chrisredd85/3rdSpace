jest.mock('server-only', () => ({}))

import {
  buildMessageEmailHtml,
  canAccessThread,
  escapeHtml,
  isOffline,
  normalizeAttachments,
  sanitizeFileName,
  sendMessageEmail,
  truncateMessage,
  type MessagingProfile,
  type VendorMessageThread,
} from '@/lib/messages/vendor-messaging'

describe('vendor messaging helpers', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    jest.restoreAllMocks()
    process.env = { ...originalEnv }
  })

  const thread = {
    id: 'thread-1',
    booking_id: 'booking-1',
    vendor_id: 'vendor-1',
    builder_id: 'builder-1',
    subject: 'Booking discussion',
    status: 'active',
    last_message_at: null,
    created_at: '2026-04-29T00:00:00Z',
    updated_at: '2026-04-29T00:00:00Z',
  } satisfies VendorMessageThread

  it('authorizes only thread participants', () => {
    const builder = { id: 'builder-1', user_id: 'user-1', display_name: 'Builder', type: 'builder' } satisfies MessagingProfile
    const vendor = { id: 'vendor-1', user_id: 'user-2', display_name: 'Vendor', type: 'vendor' } satisfies MessagingProfile
    const otherVendor = { id: 'vendor-2', user_id: 'user-3', display_name: 'Other', type: 'vendor' } satisfies MessagingProfile

    expect(canAccessThread(thread, builder)).toBe(true)
    expect(canAccessThread(thread, vendor)).toBe(true)
    expect(canAccessThread(thread, otherVendor)).toBe(false)
  })

  it('normalizes attachment records and drops malformed entries', () => {
    expect(
      normalizeAttachments([
        { name: 'contract.pdf', path: 'thread/file.pdf', size: '1200', type: 'application/pdf' },
        { name: 'preview.jpg', url: 'https://example.com/preview.jpg', type: 'image/jpeg' },
        { name: 'missing-path' },
        null,
      ])
    ).toEqual([
      { name: 'contract.pdf', path: 'thread/file.pdf', size: 1200, type: 'application/pdf', url: undefined },
      { name: 'preview.jpg', path: '', size: 0, type: 'image/jpeg', url: 'https://example.com/preview.jpg' },
    ])
  })

  it('truncates long message previews and collapses whitespace', () => {
    expect(truncateMessage('  Hello\n\nthere  ', 20)).toBe('Hello there')
    expect(truncateMessage('This message is intentionally long', 12)).toBe('This messag...')
  })

  it('sanitizes attachment filenames for storage paths', () => {
    expect(sanitizeFileName('final contract (signed).pdf')).toBe('final-contract--signed-.pdf')
    expect(sanitizeFileName('')).toBe('attachment')
  })

  it('detects offline users using recent activity', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T12:00:00Z'))

    expect(isOffline(null)).toBe(true)
    expect(isOffline('2026-04-29T11:40:00Z')).toBe(true)
    expect(isOffline('2026-04-29T11:55:00Z')).toBe(false)

    jest.useRealTimers()
  })

  it('escapes message email HTML', () => {
    const html = buildMessageEmailHtml({
      senderName: '<Vendor>',
      preview: 'Use <strong>unsafe</strong> text',
      url: 'https://example.com/messages?thread=<id>',
    })

    expect(escapeHtml(`'"<>&`)).toBe('&#039;&quot;&lt;&gt;&amp;')
    expect(html).toContain('&lt;Vendor&gt;')
    expect(html).toContain('Use &lt;strong&gt;unsafe&lt;/strong&gt; text')
    expect(html).not.toContain('<strong>unsafe</strong>')
  })

  it('sends offline message email through Resend', async () => {
    process.env.RESEND_API_KEY = 're_test'
    process.env.MESSAGE_FROM_EMAIL = '3rdPlace Messages <messages@auth.example.com>'
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '{"id":"email_456"}',
    } as Response)

    const result = await sendMessageEmail({
      to: 'recipient@example.com',
      subject: 'New message from Maya',
      html: '<p>Preview</p>',
    })

    expect(result).toEqual({ sent: true, reason: null })
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body).toMatchObject({
      from: '3rdPlace Messages <messages@auth.example.com>',
      to: ['recipient@example.com'],
      subject: 'New message from Maya',
      html: '<p>Preview</p>',
    })
  })
})
