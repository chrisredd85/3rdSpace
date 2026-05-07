import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { getPersonaCredentials } from './helpers/env'
import { loginAsPersona } from './helpers/auth'

test.describe('MVP launch E2E contracts', () => {
  test.skip(
    process.env.MVP_LAUNCH_E2E !== '1',
    'Requires seeded Supabase users, venue/vendor catalog data, magic-link response pages, and Stripe sandbox credentials.'
  )

  test('public intake creates a plan, signs up, and persists across reload', async ({ page }) => {
    await page.goto('/planner?mock=1')
    await startPublicPlan(page, 'I want to host a rooftop mixer for 80 people in Hayes Valley with an $8k budget')
    await answerPlannerQuestion(page, 'First weekend of August')
    await answerPlannerQuestion(page, 'Hayes Valley or Mission')
    await answerPlannerQuestion(page, '$8000 budget')
    await answerPlannerQuestion(page, 'Need AV, bar, and rooftop or outdoor space')
    await answerPlannerQuestion(page, 'Ticketed on Luma with guests paying for drinks')

    await expect(page.getByText(/recommendation|best fit|request hold/i).first()).toBeVisible()
    await page.getByRole('link', { name: /sign up|create account|save plan/i }).first().click()
    await expect(page).toHaveURL(/signup|login/i)

    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD to complete signup persistence.')
      return
    }
    await loginAsPersona(page, 'builder', credentials)
    await expect(page).toHaveURL(/\/planner/)
    await page.reload()
    await expect(page.getByText(/rooftop mixer|hayes valley|mission/i).first()).toBeVisible()
  })

  test('authenticated planner keeps chat state across navigation and New Event resets cleanly', async ({ page }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD.')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
    await startPublicPlan(page, 'Plan a dinner next month for 20 people in San Francisco around $8k')
    await expect(page.getByText(/dinner/i).first()).toBeVisible()

    await page.getByRole('link', { name: /experiences/i }).click()
    await expect(page).toHaveURL(/\/planner\/experiences/)
    await page.goto('/planner')
    await expect(page.getByText(/Plan a dinner next month/i)).toBeVisible()

    await page.getByRole('button', { name: /new event|new plan/i }).click()
    await expect(page.getByRole('textbox', { name: /describe your event|reply to planner agent/i }).first()).toBeVisible()
    await expect(page.getByText(/Plan a dinner next month/i)).not.toBeVisible()
  })

  test('approval flow requests a hold, authorizes it, and progresses to sent', async ({ page }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD.')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
    await startPublicPlan(page, 'Plan a mixer for 80 people in Mission next month with $8k, need AV and bar')
    await answerPlannerQuestion(page, 'Ticketed on Luma, guests pay drinks, flat rental preferred')

    await page.getByRole('button', { name: /request hold|hold venue|book venue/i }).first().click()
    await expect(page.getByText(/approval|authorize/i).first()).toBeVisible()
    await page.getByRole('button', { name: /authorize|approve/i }).first().click()
    await expect(page.getByText(/sent|queued|authorized/i).first()).toBeVisible()
  })

  test('send-to-venues authorization accepts a venue magic link and updates status', async ({ page, request }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials) {
      test.skip(true, 'Set E2E_BUILDER_EMAIL and E2E_BUILDER_PASSWORD.')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
    await startPublicPlan(page, 'Plan an SF Tech Week mixer for 120 founders in SoMa with $15k')
    await answerPlannerQuestion(page, 'Send this to three venues with AV, bar, and capacity for 120')
    await page.getByRole('button', { name: /send to \d+ venues|send to venues/i }).click()
    await page.getByRole('button', { name: /authorize|approve/i }).click()

    const inviteToken = await latestVenueInviteToken(request)
    await page.goto(`/v/respond/${inviteToken}`)
    await page.getByRole('button', { name: /accept|available/i }).click()
    await page.goto('/planner')
    await expect(page.getByText(/accepted|venue accepted/i).first()).toBeVisible()
  })

  test('payment authorizes and captures a $5k deposit in Stripe sandbox', async ({ page }) => {
    const credentials = getPersonaCredentials('builder')
    if (!credentials || !process.env.STRIPE_SECRET_KEY) {
      test.skip(true, 'Set builder credentials and STRIPE_SECRET_KEY.')
      return
    }

    await loginAsPersona(page, 'builder', credentials)
    await startPublicPlan(page, 'Plan a launch mixer for 100 people in SoMa with a $15000 budget')
    await answerPlannerQuestion(page, 'Request a $5000 deposit approval for the top venue')

    await page.getByRole('button', { name: /authorize \$5,?000 deposit|authorize deposit/i }).click()
    await expect(page.getByText(/authorized/i).first()).toBeVisible()
    await page.getByRole('button', { name: /capture deposit/i }).click()
    await expect(page.getByText(/captured|stripe/i).first()).toBeVisible()
  })
})

async function startPublicPlan(page: Page, prompt: string) {
  await page.goto('/planner?mock=1')
  const input = page.locator('textarea[name="message"], textarea[name="reply"]').first()
  await input.waitFor({ state: 'visible' })
  await input.fill(prompt)
  await page.getByRole('button', { name: /send message|send planner reply/i }).click()
}

async function answerPlannerQuestion(page: Page, answer: string) {
  const input = page.locator('textarea[name="reply"], textarea[name="message"]').first()
  await input.waitFor({ state: 'visible' })
  await input.fill(answer)
  await page.getByRole('button', { name: /send planner reply|send message/i }).click()
}

async function latestVenueInviteToken(request: APIRequestContext) {
  const response = await request.get('/api/test/venue-opportunity/latest-token')
  expect(response.ok()).toBeTruthy()
  const json = await response.json()
  expect(json.token).toMatch(/^[a-f0-9]{64}$/)
  return json.token as string
}
