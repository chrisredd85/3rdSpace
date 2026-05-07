jest.mock('server-only', () => ({}))

import { getOverdueTaskTitles, isTaskOverdue, type EventTaskRow } from '@/lib/events/workspaceHelpers'

function makeTask(overrides: Partial<EventTaskRow> = {}): EventTaskRow {
  return {
    id: 'task-1',
    event_id: 'event-1',
    title: 'Confirm venue contract',
    due_date: '2026-05-01',
    status: 'open',
    assigned_to: null,
    ...overrides,
  }
}

describe('workspaceHelpers', () => {
  it('returns overdue task titles without calling any model code', () => {
    const currentDate = new Date('2026-05-07T12:00:00Z')
    const overdueTitles = getOverdueTaskTitles([
      makeTask({ id: 'task-1', title: 'Confirm venue contract', due_date: '2026-05-01' }),
      makeTask({ id: 'task-2', title: 'Book photographer', due_date: '2026-05-08' }),
      makeTask({ id: 'task-3', title: 'Publish invite page', due_date: null }),
      makeTask({ id: 'task-4', title: 'Completed run of show', due_date: '2026-05-01', status: 'completed' }),
    ], currentDate)

    expect(overdueTitles).toEqual(['Confirm venue contract'])
  })

  it('does not mark tasks due today as overdue', () => {
    const currentDate = new Date('2026-05-07T18:30:00Z')

    expect(isTaskOverdue(
      makeTask({ due_date: '2026-05-07' }),
      currentDate
    )).toBe(false)
  })
})
