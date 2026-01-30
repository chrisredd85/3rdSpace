import { test, expect } from '@playwright/test'

test.describe('Event Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('test@example.com')
    await page.getByLabel(/password/i).fill('password123')
    await page.getByRole('button', { name: /sign in/i }).click()
    await page.waitForURL(/\/builder/)
  })

  test('should create a new event', async ({ page }) => {
    // Navigate to create event
    await page.goto('/builder/event/new')

    // Step 1: Planning
    await page.getByLabel(/event name/i).fill('Test Event')
    await page.getByLabel(/date/i).fill('2024-12-31')
    await page.getByLabel(/budget/i).fill('5000')
    await page.getByRole('button', { name: /next/i }).click()

    // Step 2: Venue selection
    await expect(page.getByText(/select venue/i)).toBeVisible()
    // Select a venue (if available)
    // await page.getByText(/venue name/i).first().click()
    // await page.getByRole('button', { name: /select/i }).click()

    // Continue through steps...
    // This is a simplified test - actual implementation would test all steps
  })
})
