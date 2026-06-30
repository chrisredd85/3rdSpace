import { orderExperienceRecordRail, selectExperienceRecord } from '@/lib/planner/experienceRecordSelection'

const records = [
  {
    id: 'old-future-plan',
    kind: 'plan' as const,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-29T10:00:00.000Z',
  },
  {
    id: 'new-mobile-plan',
    kind: 'plan' as const,
    createdAt: '2026-06-29T19:00:00.000Z',
    updatedAt: '2026-06-29T19:00:00.000Z',
  },
  {
    id: 'past-event',
    kind: 'event' as const,
    createdAt: '2026-06-28T10:00:00.000Z',
    updatedAt: '2026-06-28T10:00:00.000Z',
  },
]

describe('experience record selection', () => {
  it('defaults to the newest created planner draft when no record is explicitly selected', () => {
    expect(selectExperienceRecord(records)?.id).toBe('new-mobile-plan')
  })

  it('keeps explicit record links authoritative', () => {
    expect(selectExperienceRecord(records, 'plan:old-future-plan')?.id).toBe('old-future-plan')
  })

  it('keeps the selected record visible first in the selector rail', () => {
    const selected = selectExperienceRecord(records)

    expect(orderExperienceRecordRail(records, selected).map((record) => record.id)).toEqual([
      'new-mobile-plan',
      'old-future-plan',
      'past-event',
    ])
  })
})
