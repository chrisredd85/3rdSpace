import { expect, test, type Page } from '@playwright/test'

interface FakePlannerUser {
  name: string
  eventType: string
  prompt: string
  followUp: string
}

const fakePlannerUsers: FakePlannerUser[] = [
  {
    name: 'Maya Rivera',
    eventType: 'mixer',
    prompt: 'Host an SF Tech Week mixer for 120 founders and investors in SoMa with a $18000 budget',
    followUp: 'Late October, ticketed, 120 guests, keep it in SoMa, budget cap $18000',
  },
  {
    name: 'Alex Chen',
    eventType: 'dinner',
    prompt: 'Plan a private founder dinner for 18 people in Hayes Valley under $2500 next Friday',
    followUp: 'Friday night works, RSVP-only, 18 guests, Hayes Valley, all-in cap $2500',
  },
  {
    name: 'Jordan Lee',
    eventType: 'party',
    prompt: 'Create a ticketed warehouse party for 300 guests in Dogpatch with DJs and food trucks',
    followUp: 'Oct 17, 300 guests, Dogpatch, ticketed, budget cap $22000',
  },
  {
    name: 'Priya Shah',
    eventType: 'hackathon',
    prompt: 'Organize a 36-hour hackathon for 80 builders at a private corporate office in SF',
    followUp: 'Late June, 80 builders, SoMa, invite-only, budget $18000',
  },
  {
    name: 'Noah Kim',
    eventType: 'game outing',
    prompt: 'Book a Giants outing for 24 people with seats together and a group dinner after',
    followUp: 'Oct 18, 24 people, Embarcadero, RSVP-only, budget $6000',
  },
  {
    name: 'Sofia Martinez',
    eventType: 'retreat',
    prompt: 'Plan a wellness retreat for 45 operators in the Marina with catering and yoga',
    followUp: 'Early August, 45 people, Marina, invite-only, budget $12000',
  },
  {
    name: 'Ethan Brooks',
    eventType: 'concert',
    prompt: 'Create a one-night concert for 900 fans in the Mission with a $95000 budget',
    followUp: 'Oct 19, 900 people, Mission, ticketed, $95000 budget',
  },
  {
    name: 'Ava Nguyen',
    eventType: 'pop-up',
    prompt: 'Plan a product launch popup for 200 guests near Embarcadero with sponsors',
    followUp: 'Late September, 200 guests, Embarcadero, free RSVP, budget $30000',
  },
  {
    name: 'Miles Johnson',
    eventType: 'mixer',
    prompt: 'Host an invite-only AI policy salon for 60 executives in FiDi in late October',
    followUp: 'Late October, 60 people, FiDi, invite-only, budget cap $15000',
  },
  {
    name: 'Grace Patel',
    eventType: 'mixer',
    prompt: 'Create a brunch networking event for 75 women founders in the Castro',
    followUp: 'Oct 16, 75 people, Castro, RSVP-only, budget $9000',
  },
  {
    name: 'Liam Osei',
    eventType: 'gallery opening',
    prompt: 'Plan a photography gallery opening for 150 guests with wine and security',
    followUp: 'Late October, 150 guests, Mission, free RSVP, budget $14000',
  },
  {
    name: 'Chloe Adams',
    eventType: 'afterparty',
    prompt: 'Build a conference afterparty for 500 attendees with VIP tables and AV',
    followUp: 'Oct 17, 500 attendees, SoMa, ticketed, budget $45000',
  },
  {
    name: 'Daniel Park',
    eventType: 'dinner',
    prompt: 'Organize a charity auction for 140 donors with dinner and live music',
    followUp: 'Late November, 140 guests, Nob Hill, ticketed, budget $28000',
  },
  {
    name: 'Nina Williams',
    eventType: 'demo day',
    prompt: 'Plan a startup demo day for 220 guests with stage, livestream, and catering',
    followUp: 'Oct 15, 220 guests, SoMa, invite-only, budget $35000',
  },
  {
    name: 'Owen Garcia',
    eventType: 'birthday',
    prompt: 'Create a private birthday party for 40 people in North Beach with cocktails',
    followUp: 'Friday night, 40 people, Marina, invite-only, budget $7500',
  },
  {
    name: 'Hannah Wilson',
    eventType: 'mixer',
    prompt: 'Host a climate tech breakfast for 55 investors and founders near Potrero',
    followUp: 'Oct 16, 55 people, Potrero, RSVP-only, budget $6500',
  },
  {
    name: 'Marcus Brown',
    eventType: 'mixer',
    prompt: 'Plan a college alumni mixer for 160 guests in the Tenderloin with ticketing',
    followUp: 'Late October, 160 guests, Tenderloin, ticketed, budget $16000',
  },
  {
    name: 'Ella Thompson',
    eventType: 'run club',
    prompt: 'Organize a running club meetup for 35 people with coffee after in the Mission',
    followUp: 'Saturday morning, 35 people, Mission, free, budget $1800',
  },
  {
    name: 'Ryan Davis',
    eventType: 'tournament',
    prompt: 'Create a gaming tournament for 110 players with sponsors and prize pool',
    followUp: 'Oct 18, 110 players, SoMa, ticketed, budget $22000',
  },
  {
    name: 'Iris Morgan',
    eventType: 'retreat',
    prompt: 'Plan a board retreat for 12 executives with dinner, workspace, and transport',
    followUp: 'Late June, 12 people, Hayes Valley, invite-only, budget $12000',
  },
]

const eventSpecificQuestionCases = [
  {
    eventType: 'dinner',
    prompt: 'Plan a dinner for 20 people in SoMa on Oct 17 at 7pm with a $4000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'mixer',
    prompt: 'Plan a mixer for 80 people in SoMa on Oct 17 at 6pm with a $9000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'day party',
    prompt: 'Plan a day party for 90 people in the Mission on Oct 17 from 2pm to 8pm with a $9000 budget, ticketed on Luma, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'listening party',
    prompt: 'Plan a listening party for 75 people in SoMa on Oct 17 at 8pm with a $7000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'launch party',
    prompt: 'Plan a launch party for 120 people in Dogpatch on Oct 17 at 6pm with a $15000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'birthday',
    prompt: 'Plan a birthday for 40 people in North Beach on Oct 17 at 8pm with a $5000 budget, invite-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'house party',
    prompt: 'Plan a house party for 50 people in the Mission on Oct 17 at 9pm with a $2000 budget, invite-only, at my apartment',
    question: 'Do you need supplies, catering, drinks, speakers, or cleanup?',
  },
  {
    eventType: 'concert',
    prompt: 'Plan a concert for 500 people in the Mission on Oct 17 at 8pm with a $45000 budget, ticketed, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'club night',
    prompt: 'Plan a club night for 300 people in SoMa on Oct 17 at 10pm with a $18000 budget, ticketed, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'run club',
    prompt: 'Plan a run club for 35 people in the Mission on Oct 17 at 9am with a $1000 budget, free RSVP',
    question: 'Do you have a route and pace, or should I suggest one?',
  },
  {
    eventType: 'fitness class',
    prompt: 'Plan a yoga fitness class for 30 people in Hayes Valley on Oct 17 at 10am with a $1500 budget, ticketed, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'workshop',
    prompt: 'Plan a workshop for 45 people in SoMa on Oct 17 at 1pm with a $3500 budget, ticketed, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'panel',
    prompt: 'Plan a panel for 100 people in FiDi on Oct 17 at 6pm with a $8000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'conference',
    prompt: 'Plan a conference for 200 people in SoMa on Oct 17 at 9am with a $30000 budget, ticketed, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'hackathon',
    prompt: 'Plan a hackathon for 80 builders in SoMa on Oct 17 at 9am with a $18000 budget, invite-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'demo day',
    prompt: 'Plan a demo day for 150 people in SoMa on Oct 17 at 5pm with a $20000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'game outing',
    prompt: 'Plan a Giants game outing for 20 people in Embarcadero on Oct 17 at 6pm with a $5000 budget, ticketed',
    question: 'What is the target seat budget per person and preferred section?',
  },
  {
    eventType: 'watch party',
    prompt: 'Plan a watch party for 70 people in SoMa on Oct 17 at 5pm with a $5000 budget, RSVP-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'pop-up',
    prompt: 'Plan a pop-up for 120 people in Hayes Valley on Oct 17 at 12pm with a $10000 budget, free RSVP, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
  {
    eventType: 'retreat',
    prompt: 'Plan a retreat for 12 people in Marin on Oct 17 at 9am with a $12000 budget, invite-only, need a venue',
    question: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
  },
]

test.describe('Agent Planner chat', () => {
  test.describe.configure({ mode: 'serial' })

  test('20 fake users can create and complete mock agent planner event drafts', async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 1600, height: 900 })

    let plannerApiCalls = 0
    await page.route('**/api/planner/**', async (route) => {
      plannerApiCalls += 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Planner API should not be called in mock mode' }),
      })
    })

    for (const fakeUser of fakePlannerUsers) {
      await test.step(`${fakeUser.name} creates a ${fakeUser.eventType} plan`, async () => {
        await resetMockPlanner(page)

        await expect(page.getByRole('heading', { name: /what 3rdplace do you want to create/i })).toBeVisible()
        await page.locator('form[data-planner-hydrated="true"]').waitFor({ state: 'visible' })

        const eventInput = page.locator('textarea[name="message"]')
        await eventInput.fill(fakeUser.prompt)
        await expect(eventInput).toHaveValue(fakeUser.prompt)
        await page.getByRole('button', { name: /send message/i }).click()

        await expect(page.getByText('Active plan', { exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: /plan/i }).first()).toBeVisible()
        await expect(page.getByText(fakeUser.prompt)).toBeVisible()
        await expect(page.getByText(/3rdSpace Agent/i)).toBeVisible()
        await expect(page.getByText(/select one answer/i).first()).toBeVisible()
        const livePlanPanel = page.locator('aside').filter({ hasText: 'Event Plan' })
        await expect(livePlanPanel.getByText('Event Type')).toBeVisible()

        const replyInput = page.locator('textarea[name="reply"]')
        await replyInput.fill(fakeUser.followUp)
        await expect(replyInput).toHaveValue(fakeUser.followUp)
        await page.getByRole('button', { name: /send planner reply/i }).click()

        await expect(page.getByText(fakeUser.followUp)).toBeVisible()
        await expect(page.getByText(/select one answer|i have the core context|three mock venue and vendor paths/i).first()).toBeVisible()
        await expect(livePlanPanel).toBeVisible()
        await expect(page.getByText(/failed to create plan/i)).not.toBeVisible()
      })
    }

    expect(plannerApiCalls).toBe(0)
  })

  test('New Plan clears the active mock conversation', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/planner?mock=1&draft=Plan%20a%20day%20party%20for%2090%20people%20in%20the%20Mission%20with%20a%20%249000%20budget', {
      waitUntil: 'domcontentloaded',
    })

    await expect(page.getByText('Active plan', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /new event/i }).click()

    await expect(page).toHaveURL('/planner')
    await expect(page.getByRole('heading', { name: /what 3rdplace do you want to create/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /describe your event/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /day party plan/i })).not.toBeVisible()
  })

  test('Event Plan side panel renders structured sections', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/planner?mock=1&draft=Plan%20a%20day%20party%20for%2090%20people%20in%20the%20Mission%20with%20a%20%249000%20budget', {
      waitUntil: 'domcontentloaded',
    })

    const livePlanPanel = page.locator('aside').filter({ hasText: 'Event Plan' })
    await expect(livePlanPanel).toBeVisible()
    await expect(livePlanPanel.getByText('Profit Window')).toBeVisible()
    await expect(livePlanPanel.getByText('Shopping List')).toBeVisible()
    await expect(livePlanPanel.getByText('Payment + Agent Authorization')).toBeVisible()
  })

  test('day party mock asks coherent follow-up questions before recommendations', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/planner?mock=1', { waitUntil: 'domcontentloaded' })

    await page.locator('form[data-planner-hydrated="true"]').waitFor({ state: 'visible' })
    await page.locator('textarea[name="message"]').fill('I want to host a day party')
    await page.getByRole('button', { name: /send message/i }).click()

    await expect(page.getByRole('heading', { name: /day party plan/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /what's your target date or timeframe/i })).toBeVisible()
    await expect(page.getByText('What city or neighborhood should I search in?', { exact: true })).not.toBeVisible()
    await expect(page.getByText('Do you need a DJ, or are you bringing your own music?', { exact: true })).not.toBeVisible()

    const replyInput = page.locator('textarea[name="reply"]')
    await replyInput.fill('Oct 17 from 2pm to 8pm')
    await page.getByRole('button', { name: /send planner reply/i }).click()

    await expect(page.getByRole('heading', { name: /what area of the bay area works best/i })).toBeVisible()
    await expect(page.getByText('Do you need a DJ, or are you bringing your own music?', { exact: true })).not.toBeVisible()

    await replyInput.fill(
      'San Francisco, Mission, outdoor patio vibe, 90 people, $9000 budget, ticketed on Luma https://luma.com/day-party, need a venue, need a DJ, bar package alcohol, revenue share with the bar, exclusive buyout'
    )
    await page.getByRole('button', { name: /send planner reply/i }).click()

    await expect(page.getByRole('heading', { name: /does the ticket include food/i })).toBeVisible()
    await expect(page.getByText(/three mock venue and vendor paths/i)).not.toBeVisible()
  })

  test('all 20 event playbooks ask a structured next question', async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 1600, height: 900 })

    for (const eventCase of eventSpecificQuestionCases) {
      await test.step(`${eventCase.eventType} asks a structured next question`, async () => {
        await resetMockPlanner(page)
        await page.locator('form[data-planner-hydrated="true"]').waitFor({ state: 'visible' })
        await page.locator('textarea[name="message"]').fill(eventCase.prompt)
        await page.getByRole('button', { name: /send message/i }).click()

        await expect(page.getByText(/select one answer/i).first()).toBeVisible()
      })
    }
  })
})

async function resetMockPlanner(page: Page) {
  await page.goto('/planner?mock=1', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/planner?mock=1', { waitUntil: 'domcontentloaded' })
}
