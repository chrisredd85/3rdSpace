import 'server-only'

const REQUIRED_PRODUCTION_SECRETS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'CRON_SECRET',
  'SETTLEMENT_ACK_TOKEN_SECRET',
  'VENUE_INVITE_SECRET',
  'VENDOR_INVITE_SECRET',
  'TOKEN_CRYPTO_KEY',
  'EMAIL_TOKEN_ENCRYPTION_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_PLACES_API_KEY',
] as const

export type RequiredProductionSecret = (typeof REQUIRED_PRODUCTION_SECRETS)[number]

export function listMissingRequiredProductionSecrets(env: NodeJS.ProcessEnv = process.env) {
  return REQUIRED_PRODUCTION_SECRETS.filter((name) => !env[name]?.trim())
}

export function validateRequiredProductionSecrets(env: NodeJS.ProcessEnv = process.env) {
  const missing = listMissingRequiredProductionSecrets(env)
  if (missing.length === 0) return

  if (env.PLAYWRIGHT_TEST === '1') {
    console.warn('[required-secrets] Skipping production secret validation for Playwright test server.')
    return
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(`Missing required production secrets: ${missing.join(', ')}`)
  }

  for (const name of missing) {
    console.warn(`[required-secrets] Missing ${name}; required in production.`)
  }
}
