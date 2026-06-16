import { hasImportedGuestAttendanceLabel } from '@/lib/planner/experienceGuestStatus'

describe('hasImportedGuestAttendanceLabel', () => {
  it('treats records without imported attendance as missing guest data', () => {
    expect(hasImportedGuestAttendanceLabel('No imported attendance yet')).toBe(false)
    expect(hasImportedGuestAttendanceLabel('No confirmed attendance imported yet')).toBe(false)
  })

  it('treats confirmed attendance labels as imported guest data', () => {
    expect(hasImportedGuestAttendanceLabel('30 confirmed')).toBe(true)
    expect(hasImportedGuestAttendanceLabel('1,250 confirmed')).toBe(true)
  })
})
