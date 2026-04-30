import { expect, type Page } from '@playwright/test'
import type { PersonaRole } from './env'

type PersonaCredentials = {
  email: string
  password: string
}

export async function loginAsPersona(
  page: Page,
  role: PersonaRole,
  credentials: PersonaCredentials
) {
  await page.goto(`/login/${role}`)
  await page.getByLabel(/^email$/i).fill(credentials.email)
  await page.getByLabel(/^password$/i).fill(credentials.password)
  await page.getByRole('button', { name: /^sign in/i }).click()
  await expect(page).toHaveURL(new RegExp(`/${role}`), { timeout: 15000 })
}
