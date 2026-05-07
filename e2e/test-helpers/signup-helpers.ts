import { Page, expect } from '@playwright/test'

/**
 * Test helper utilities for signup flows
 */

export interface BuilderSignupData {
  name: string
  email: string
  password: string
}

export interface VenueSignupData {
  venue_name: string
  contact_name: string
  email: string
  phone: string
  venue_type: string
  capacity: number
  password: string
}

export interface VendorSignupData {
  business_name: string
  your_name: string
  email: string
  phone: string
  service_type: string
  service_area: string
  password: string
}

/**
 * Generate a unique email for testing
 */
export function generateTestEmail(userType: string): string {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000)
  return `test-${userType}-${timestamp}-${random}@example.com`
}

/**
 * Fill out Community Builder signup form
 */
export async function fillBuilderSignupForm(
  page: Page,
  data: BuilderSignupData
): Promise<void> {
  await page.getByLabel(/full name/i).fill(data.name)
  await page.getByLabel(/email/i).fill(data.email)
  await page.getByLabel(/password/i).fill(data.password)
}

/**
 * Fill out Venue Owner signup form
 */
export async function fillVenueSignupForm(
  page: Page,
  data: VenueSignupData
): Promise<void> {
  await page.getByLabel(/venue name/i).fill(data.venue_name)
  await page.getByLabel(/contact name/i).fill(data.contact_name)
  await page.getByLabel(/email/i).fill(data.email)
  await page.getByLabel(/phone/i).fill(data.phone)
  await page.getByLabel(/venue type/i).selectOption(data.venue_type)
  await page.getByLabel(/capacity/i).fill(data.capacity.toString())
  await page.getByLabel(/password/i).fill(data.password)
}

/**
 * Fill out Vendor signup form
 */
export async function fillVendorSignupForm(
  page: Page,
  data: VendorSignupData
): Promise<void> {
  await page.getByLabel(/business name/i).fill(data.business_name)
  await page.getByLabel(/your name/i).fill(data.your_name)
  await page.getByLabel(/email/i).fill(data.email)
  await page.getByLabel(/phone/i).fill(data.phone)
  await page.getByLabel(/service type/i).selectOption(data.service_type)
  await page.getByLabel(/service area/i).fill(data.service_area)
  await page.getByLabel(/password/i).fill(data.password)
}

/**
 * Complete full signup flow for Community Builder
 */
export async function completeBuilderSignup(
  page: Page,
  data?: Partial<BuilderSignupData>
): Promise<void> {
  const signupData: BuilderSignupData = {
    name: data?.name || 'Test Builder',
    email: data?.email || generateTestEmail('builder'),
    password: data?.password || 'TestPassword123!',
  }

  // Navigate to signup
  await page.goto('/signup')

  // Select Community Builder
  await page.getByText(/community builder/i).first().click()

  // Fill form
  await fillBuilderSignupForm(page, signupData)

  // Submit
  await page.getByRole('button', { name: /create account/i }).click()

  // Wait for redirect
  await page.waitForURL(/\/builder/, { timeout: 10000 })
}

/**
 * Complete full signup flow for Venue Owner
 */
export async function completeVenueSignup(
  page: Page,
  data?: Partial<VenueSignupData>
): Promise<void> {
  const signupData: VenueSignupData = {
    venue_name: data?.venue_name || 'Test Venue',
    contact_name: data?.contact_name || 'John Doe',
    email: data?.email || generateTestEmail('venue'),
    phone: data?.phone || '5551234567',
    venue_type: data?.venue_type || 'loft_warehouse',
    capacity: data?.capacity || 100,
    password: data?.password || 'TestPassword123!',
  }

  // Navigate to signup
  await page.goto('/signup')

  // Select Venue Owner
  await page.getByText(/venue owner/i).first().click()

  // Fill form
  await fillVenueSignupForm(page, signupData)

  // Submit
  await page.getByRole('button', { name: /create account/i }).click()

  // Wait for redirect
  await page.waitForURL(/\/venue/, { timeout: 10000 })
}

/**
 * Complete full signup flow for Vendor
 */
export async function completeVendorSignup(
  page: Page,
  data?: Partial<VendorSignupData>
): Promise<void> {
  const signupData: VendorSignupData = {
    business_name: data?.business_name || 'Test Catering Co',
    your_name: data?.your_name || 'Jane Smith',
    email: data?.email || generateTestEmail('vendor'),
    phone: data?.phone || '5559876543',
    service_type: data?.service_type || 'catering',
    service_area: data?.service_area || 'San Francisco, CA',
    password: data?.password || 'TestPassword123!',
  }

  // Navigate to signup
  await page.goto('/signup')

  // Select Vendor
  await page.getByText(/^vendor$/i).first().click()

  // Fill form
  await fillVendorSignupForm(page, signupData)

  // Submit
  await page.getByRole('button', { name: /create account/i }).click()

  // Wait for redirect
  await page.waitForURL(/\/vendor/, { timeout: 10000 })
}

/**
 * Verify signup page is loaded correctly
 */
export async function verifySignupPage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/join 3rdplace/i)).toBeVisible()
  await expect(page.getByText(/choose your account type/i)).toBeVisible()
  await expect(page.getByText(/community builder/i)).toBeVisible()
  await expect(page.getByText(/venue owner/i)).toBeVisible()
  await expect(page.getByText(/^vendor$/i)).toBeVisible()
}
