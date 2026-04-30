import { expect, test } from '@playwright/test'
import { businessScenarios, e2ePersonas } from '../fixtures/personas'
import { annotateFailure } from '../helpers/failure-taxonomy'

function venueKickback(perHeadRate: number, checkedInAttendees: number) {
  return perHeadRate * checkedInAttendees
}

function hourlyVendorFee(hourlyRate: number, hours: number) {
  return hourlyRate * hours
}

test.describe('business math contracts', () => {
  test('venue per-head kickback uses verified attendance', async ({}, testInfo) => {
    annotateFailure(testInfo, 'MONEY_CALCULATION_ERROR', 'Venue kickback math is the trust boundary for bar-owner payouts')

    expect(
      venueKickback(e2ePersonas.venue.perHeadKickback, businessScenarios.verifiedAttendance)
    ).toBe(300)
  })

  test('DJ hourly rate calculates projected vendor fee', async ({}, testInfo) => {
    annotateFailure(testInfo, 'MONEY_CALCULATION_ERROR', 'DJ hourly pricing should preserve the 45/hr contract')

    expect(
      hourlyVendorFee(e2ePersonas.vendor.hourlyRate, businessScenarios.djHours)
    ).toBe(180)
  })
})
