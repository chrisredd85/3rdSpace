import { hasActiveVenueHold } from '@/lib/planner/venueHold'

describe('hasActiveVenueHold', () => {
  it('requires a completed action with a structured hold_confirmed outcome', async () => {
    const db = makeDb([
      {
        id: 'action-1',
        status: 'complete',
        result_metadata: {
          admin_task_outcome: {
            outcome: 'hold_confirmed',
          },
        },
      },
    ])

    await expect(hasActiveVenueHold(db.client, 'plan-1')).resolves.toBe(true)
    expect(db.eq).toHaveBeenCalledWith('status', 'complete')
    expect(db.select).toHaveBeenCalledWith('id,status,result_metadata')
  })

  it('does not treat venue_unavailable as an active hold', async () => {
    const db = makeDb([
      {
        id: 'action-1',
        status: 'complete',
        result_metadata: {
          admin_task_outcome: {
            outcome: 'venue_unavailable',
          },
        },
      },
    ])

    await expect(hasActiveVenueHold(db.client, 'plan-1')).resolves.toBe(false)
  })

  it('fails closed when the hold evidence lookup errors', async () => {
    const db = makeDb(null, { message: 'database unavailable' })
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(hasActiveVenueHold(db.client, 'plan-1')).resolves.toBe(false)

    expect(consoleSpy).toHaveBeenCalledWith(
      '[planner.venueHold] Active hold lookup error',
      { message: 'database unavailable' }
    )
    consoleSpy.mockRestore()
  })
})

function makeDb(data: unknown[] | null, error: { message?: string } | null = null) {
  const eq = jest.fn()
  const query = {
    eq,
    limit: jest.fn().mockResolvedValue({ data, error }),
    then: undefined,
  }
  eq.mockReturnValue(query)
  const select = jest.fn(() => query)
  const from = jest.fn(() => ({ select }))

  return {
    client: { from } as unknown as Parameters<typeof hasActiveVenueHold>[0],
    select,
    eq,
  }
}
