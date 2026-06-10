jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import {
  clearContactDisambiguationCache,
  contactDisambiguationResultSchema,
  disambiguateBookingContact,
} from '@/lib/ai/agents/contactDisambiguationAgent'

describe('contactDisambiguationAgent', () => {
  beforeEach(() => {
    clearContactDisambiguationCache()
  })

  it('returns an empty ranking for empty input without calling the model', async () => {
    const create = jest.fn()

    const result = await disambiguateBookingContact({
      emails: [],
      venue_name: 'North Pier Hall',
      venue_type: 'venue',
    }, { create })

    expect(result).toEqual({ ranked_emails: [] })
    expect(create).not.toHaveBeenCalled()
  })

  it('passes through a single email without calling the model', async () => {
    const create = jest.fn()

    const result = await disambiguateBookingContact({
      emails: [{ email: 'events@northpier.com', source_path: '/contact' }],
      venue_name: 'North Pier Hall',
      venue_type: 'venue',
    }, { create })

    expect(result.ranked_emails).toEqual([{
      email: 'events@northpier.com',
      likelihood_booking_contact: 1,
      reasoning: 'Only one public contact email was found.',
    }])
    expect(create).not.toHaveBeenCalled()
  })

  it('uses structured model output and preserves every input email exactly once', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_emails: [
              {
                email: 'events@northpier.com',
                likelihood_booking_contact: 0.94,
                reasoning: 'Events mailbox is most relevant.',
              },
              {
                email: 'events@northpier.com',
                likelihood_booking_contact: 0.88,
                reasoning: 'Duplicate should be removed.',
              },
              {
                email: 'sales@unrelated.com',
                likelihood_booking_contact: 0.7,
                reasoning: 'Not an input email.',
              },
            ],
          }),
        },
      }],
    })

    const result = await disambiguateBookingContact({
      emails: [
        { email: 'events@northpier.com', source_path: '/events' },
        { email: 'info@northpier.com', source_path: '/contact' },
      ],
      venue_name: 'North Pier Hall',
      venue_type: 'venue',
    }, { create })

    expect(create).toHaveBeenCalledTimes(1)
    expect(contactDisambiguationResultSchema.safeParse(result).success).toBe(true)
    expect(result.ranked_emails.map((email) => email.email)).toEqual([
      'events@northpier.com',
      'info@northpier.com',
    ])
    expect(result.ranked_emails[1].likelihood_booking_contact).toBe(0.2)
  })

  it('caches identical multi-email requests for 24 hours', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_emails: [
              {
                email: 'events@northpier.com',
                likelihood_booking_contact: 0.9,
                reasoning: 'Best fit.',
              },
              {
                email: 'info@northpier.com',
                likelihood_booking_contact: 0.3,
                reasoning: 'Generic.',
              },
            ],
          }),
        },
      }],
    })
    const input = {
      emails: [
        { email: 'events@northpier.com', source_path: '/events' },
        { email: 'info@northpier.com', source_path: '/contact' },
      ],
      venue_name: 'North Pier Hall',
      venue_type: 'venue',
    }

    await disambiguateBookingContact(input, { create })
    await disambiguateBookingContact(input, { create })

    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed model output', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_emails: [{
              email: 'events@northpier.com',
              likelihood_booking_contact: 2,
              reasoning: 'Invalid score.',
            }],
          }),
        },
      }],
    })

    await expect(disambiguateBookingContact({
      emails: [
        { email: 'events@northpier.com', source_path: '/events' },
        { email: 'info@northpier.com', source_path: '/contact' },
      ],
      venue_name: 'North Pier Hall',
      venue_type: 'venue',
    }, { create })).rejects.toThrow()
  })
})
