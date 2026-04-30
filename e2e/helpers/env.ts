export type PersonaRole = 'builder' | 'venue' | 'vendor'

const roleEnvPrefix: Record<PersonaRole, string> = {
  builder: 'BUILDER',
  venue: 'VENUE',
  vendor: 'VENDOR',
}

export function getBaseUrl() {
  return process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3100'
}

export function getPersonaCredentials(role: PersonaRole) {
  const prefix = roleEnvPrefix[role]
  const email = process.env[`E2E_${prefix}_EMAIL`]
  const password = process.env[`E2E_${prefix}_PASSWORD`] || process.env.E2E_TEST_PASSWORD

  if (!email || !password) return null

  return { email, password }
}

export function hasSupabaseAdminEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export function missingEnv(keys: string[]) {
  return keys.filter((key) => !process.env[key])
}
