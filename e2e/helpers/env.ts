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
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) return false

  return !isPlaceholderSupabaseUrl(supabaseUrl) && !isPlaceholderSecret(serviceRoleKey)
}

export function missingEnv(keys: string[]) {
  return keys.filter((key) => !process.env[key])
}

function isPlaceholderSupabaseUrl(value: string) {
  return (
    value.includes('127.0.0.1:54321') ||
    value.includes('localhost:54321') ||
    value.includes('example.supabase.co')
  )
}

function isPlaceholderSecret(value: string) {
  return value.startsWith('ci-placeholder') || value.includes('placeholder')
}
