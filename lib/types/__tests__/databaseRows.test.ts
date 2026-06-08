import { isJsonObject, toJsonObject } from '@/lib/types/databaseRows'

describe('databaseRows JSON helpers', () => {
  it('recognizes plain JSON objects', () => {
    expect(isJsonObject({ eventId: 'evt_123', attempts: 1 })).toBe(true)
    expect(isJsonObject(['evt_123'])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
  })

  it('normalizes non-object JSON payloads to an empty object', () => {
    expect(toJsonObject({ eventId: 'evt_123' })).toEqual({ eventId: 'evt_123' })
    expect(toJsonObject('evt_123')).toEqual({})
    expect(toJsonObject(null)).toEqual({})
  })
})
