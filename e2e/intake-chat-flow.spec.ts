import { expect, test, type Page } from '@playwright/test'
import { humanizeEventType } from '../lib/planner/archetypes'
import { PILOT_PHRASES, type PilotPhraseExpectation } from '../test/fixtures/pilot-phrases'

const PR_SUBSET_PHRASES = [
  'happy hour',
  'founder happy hour',
  'startup mixer',
  'founder dinner',
  'supper club',
  'brunch',
  'rooftop day party',
  'pilates class',
  'yoga class',
  'run club',
  'tennis event',
  'bowling night',
  'listening party',
  'open mic',
  'watch party',
  'demo day',
  'panel discussion',
  'workshop',
  'hackathon',
  'art show',
] as const

const phrasesUnderTest =
  process.env.PILOT_PHRASE_E2E_FULL === '1'
    ? PILOT_PHRASES
    : PR_SUBSET_PHRASES.map((phrase) => requirePilotPhraseFixture(phrase))

test.describe('planner intake phrase chat flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'Pilot phrase intake browser coverage runs in Chromium.')
  })

  for (const fixture of phrasesUnderTest) {
    test(`classifies "${fixture.phrase}" as ${fixture.expected_archetype} in mock planner chat`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      await forcePrivateDraftMode(page)
      await resetMockPlanner(page)

      const messageInput = page.locator('textarea[name="message"]')
      await messageInput.fill(fixture.phrase)
      await page.getByRole('button', { name: /send message/i }).click()

      await expect(page.getByText('Active planner workspace', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(fixture.phrase, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('textbox', { name: /reply to planner agent/i })).toBeVisible({ timeout: 15_000 })

      const displayName = humanizeEventType(fixture.expected_archetype)
      expect(displayName).toBeTruthy()
      await expect(
        page.getByRole('heading', {
          name: new RegExp(`${escapeRegExp(displayName ?? fixture.expected_archetype)}\\s+plan`, 'i'),
        }).first()
      ).toBeVisible({ timeout: 15_000 })

      await expect(page.getByText(/failed to create plan/i)).toHaveCount(0)
    })
  }
})

function requirePilotPhraseFixture(phrase: string): PilotPhraseExpectation {
  const fixture = PILOT_PHRASES.find((candidate) => candidate.phrase === phrase)
  if (!fixture) {
    throw new Error(`Missing pilot phrase fixture for "${phrase}"`)
  }
  return fixture
}

async function forcePrivateDraftMode(page: Page) {
  await page.route('**/api/planner/public-intake', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Public draft intake unavailable in this mock smoke' }),
    })
  })
}

async function resetMockPlanner(page: Page) {
  await page.goto('/planner?mock=1', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/planner?mock=1', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /what should we plan next/i })).toBeVisible({
    timeout: 30_000,
  })
  await page.locator('form[data-planner-hydrated="true"]').waitFor({ state: 'visible', timeout: 30_000 })
  await expect(page.locator('textarea[name="message"]')).toBeEnabled({ timeout: 30_000 })
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
