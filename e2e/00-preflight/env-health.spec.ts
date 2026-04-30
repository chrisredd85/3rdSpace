import { expect, test } from '@playwright/test'
import { missingEnv } from '../helpers/env'

test.describe('preflight: environment contract', () => {
  test('documents missing optional E2E credentials without failing local smoke runs', async ({}, testInfo) => {
    const missing = missingEnv([
      'E2E_BUILDER_EMAIL',
      'E2E_VENUE_EMAIL',
      'E2E_VENDOR_EMAIL',
      'E2E_TEST_PASSWORD',
    ])

    if (missing.length > 0) {
      testInfo.annotations.push({
        type: 'TEST_DATA_SETUP',
        description: `Role workflow tests will skip until these env vars exist: ${missing.join(', ')}`,
      })
    }

    expect(Array.isArray(missing)).toBe(true)
  })
})
