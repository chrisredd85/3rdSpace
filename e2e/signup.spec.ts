import { test, expect } from '@playwright/test'

// Helper function to generate unique email
function generateEmail(userType: string): string {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000)
  return `test-${userType}-${timestamp}-${random}@example.com`
}

test.describe('Signup Flow - All User Types', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/signup')
  })

  test.describe('Community Builder Signup', () => {
    test('should complete community builder signup flow', async ({ page }) => {
      // Step 1: Verify signup page loads
      await expect(page.getByText(/join 3rdspace/i)).toBeVisible()
      await expect(page.getByText(/choose your account type/i)).toBeVisible()

      // Step 2: Select Community Builder
      await page.getByText(/community builder/i).first().click()

      // Step 3: Verify form appears
      await expect(page.getByText(/create your account/i)).toBeVisible()
      await expect(page.getByText(/join as a community builder/i)).toBeVisible()

      // Step 4: Fill out the form
      const email = generateEmail('builder')
      await page.getByLabel(/full name/i).fill('Test Builder')
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/password/i).fill('TestPassword123!')

      // Step 5: Submit form
      await page.getByRole('button', { name: /create account/i }).click()

      // Step 6: Verify success and redirect
      await expect(page).toHaveURL(/\/builder/, { timeout: 10000 })
    })

    test('should show validation errors for community builder form', async ({ page }) => {
      // Select Community Builder
      await page.getByText(/community builder/i).first().click()

      // Try to submit empty form
      await page.getByRole('button', { name: /create account/i }).click()

      // Should show validation errors
      await expect(page.getByText(/name must be at least/i).or(page.getByText(/required/i))).toBeVisible()
    })
  })

  test.describe('Venue Owner Signup', () => {
    test('should complete venue owner signup flow', async ({ page }) => {
      // Step 1: Select Venue Owner
      await page.getByText(/venue owner/i).first().click()

      // Step 2: Verify form appears
      await expect(page.getByText(/create your account/i)).toBeVisible()
      await expect(page.getByText(/join as a venue owner/i)).toBeVisible()

      // Step 3: Fill out the form
      const email = generateEmail('venue')
      await page.getByLabel(/venue name/i).fill('Test Venue')
      await page.getByLabel(/contact name/i).fill('John Doe')
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/phone/i).fill('5551234567')
      
      // Select venue type
      await page.getByLabel(/venue type/i).selectOption('loft_warehouse')
      
      // Fill capacity
      await page.getByLabel(/capacity/i).fill('100')
      
      // Fill password
      await page.getByLabel(/password/i).fill('TestPassword123!')

      // Step 4: Submit form
      await page.getByRole('button', { name: /create account/i }).click()

      // Step 5: Verify success and redirect
      await expect(page).toHaveURL(/\/venue/, { timeout: 10000 })
    })

    test('should show validation errors for venue owner form', async ({ page }) => {
      // Select Venue Owner
      await page.getByText(/venue owner/i).first().click()

      // Try to submit empty form
      await page.getByRole('button', { name: /create account/i }).click()

      // Should show validation errors
      await expect(page.getByText(/venue name must be at least/i).or(page.getByText(/required/i))).toBeVisible()
    })

    test('should allow going back from venue owner form', async ({ page }) => {
      // Select Venue Owner
      await page.getByText(/venue owner/i).first().click()

      // Click back button
      await page.getByRole('button', { name: /back/i }).click()

      // Should return to user type selection
      await expect(page.getByText(/choose your account type/i)).toBeVisible()
    })
  })

  test.describe('Vendor Signup', () => {
    test('should complete vendor signup flow', async ({ page }) => {
      // Step 1: Select Vendor
      await page.getByText(/^vendor$/i).first().click()

      // Step 2: Verify form appears
      await expect(page.getByText(/create your account/i)).toBeVisible()
      await expect(page.getByText(/join as a vendor/i)).toBeVisible()

      // Step 3: Fill out the form
      const email = generateEmail('vendor')
      await page.getByLabel(/business name/i).fill('Test Catering Co')
      await page.getByLabel(/your name/i).fill('Jane Smith')
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/phone/i).fill('5559876543')
      
      // Select service type
      await page.getByLabel(/service type/i).selectOption('catering')
      
      // Fill service area
      await page.getByLabel(/service area/i).fill('San Francisco, CA')
      
      // Fill password
      await page.getByLabel(/password/i).fill('TestPassword123!')

      // Step 4: Submit form
      await page.getByRole('button', { name: /create account/i }).click()

      // Step 5: Verify success and redirect
      await expect(page).toHaveURL(/\/vendor/, { timeout: 10000 })
    })

    test('should show validation errors for vendor form', async ({ page }) => {
      // Select Vendor
      await page.getByText(/^vendor$/i).first().click()

      // Try to submit empty form
      await page.getByRole('button', { name: /create account/i }).click()

      // Should show validation errors
      await expect(page.getByText(/business name must be at least/i).or(page.getByText(/required/i))).toBeVisible()
    })

    test('should allow going back from vendor form', async ({ page }) => {
      // Select Vendor
      await page.getByText(/^vendor$/i).first().click()

      // Click back button
      await page.getByRole('button', { name: /back/i }).click()

      // Should return to user type selection
      await expect(page.getByText(/choose your account type/i)).toBeVisible()
    })
  })

  test.describe('Google OAuth Signup', () => {
    test('should show Google signup button', async ({ page }) => {
      // Verify Google button is visible
      await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
    })

    test('should handle Google OAuth click', async ({ page }) => {
      // Click Google button (will redirect to Google, so we just verify it's clickable)
      const googleButton = page.getByRole('button', { name: /continue with google/i })
      await expect(googleButton).toBeEnabled()
      
      // Note: Actual OAuth flow would redirect to Google, so we don't test the full flow here
      // In a real test, you'd mock the OAuth response or use test credentials
    })
  })

  test.describe('Navigation and UI', () => {
    test('should navigate to login from signup page', async ({ page }) => {
      await page.getByRole('link', { name: /sign in/i }).click()
      await expect(page).toHaveURL(/\/login/)
    })

    test('should display all three user type cards', async ({ page }) => {
      await expect(page.getByText(/community builder/i)).toBeVisible()
      await expect(page.getByText(/venue owner/i)).toBeVisible()
      await expect(page.getByText(/^vendor$/i)).toBeVisible()
    })

    test('should show user type card features', async ({ page }) => {
      // Check Community Builder features
      await expect(page.getByText(/create and manage events/i)).toBeVisible()
      await expect(page.getByText(/book venues and vendors/i)).toBeVisible()

      // Check Venue Owner features
      await expect(page.getByText(/showcase your venue/i)).toBeVisible()
      await expect(page.getByText(/manage bookings/i)).toBeVisible()

      // Check Vendor features
      await expect(page.getByText(/create service listings/i)).toBeVisible()
      await expect(page.getByText(/receive booking requests/i)).toBeVisible()
    })
  })

  test.describe('Form Validation', () => {
    test('should validate email format', async ({ page }) => {
      await page.getByText(/community builder/i).first().click()
      
      await page.getByLabel(/full name/i).fill('Test User')
      await page.getByLabel(/email/i).fill('invalid-email')
      await page.getByLabel(/password/i).fill('TestPassword123!')
      
      await page.getByRole('button', { name: /create account/i }).click()
      
      // Should show email validation error
      await expect(page.getByText(/invalid email/i)).toBeVisible()
    })

    test('should validate password length', async ({ page }) => {
      await page.getByText(/community builder/i).first().click()
      
      await page.getByLabel(/full name/i).fill('Test User')
      await page.getByLabel(/email/i).fill('test@example.com')
      await page.getByLabel(/password/i).fill('12345') // Too short
      
      await page.getByRole('button', { name: /create account/i }).click()
      
      // Should show password validation error
      await expect(page.getByText(/password must be at least 6/i)).toBeVisible()
    })

    test('should validate venue capacity is a number', async ({ page }) => {
      await page.getByText(/venue owner/i).first().click()
      
      await page.getByLabel(/venue name/i).fill('Test Venue')
      await page.getByLabel(/contact name/i).fill('John Doe')
      await page.getByLabel(/email/i).fill('test@example.com')
      await page.getByLabel(/phone/i).fill('5551234567')
      await page.getByLabel(/venue type/i).selectOption('loft_warehouse')
      await page.getByLabel(/capacity/i).fill('0') // Invalid capacity
      await page.getByLabel(/password/i).fill('TestPassword123!')
      
      await page.getByRole('button', { name: /create account/i }).click()
      
      // Should show capacity validation error
      await expect(page.getByText(/capacity must be at least 1/i)).toBeVisible()
    })
  })
})
