import { hasSupabaseAdminEnv } from '../e2e/helpers/env'

describe('e2e Supabase admin env detection', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('does not treat CI placeholder Supabase values as usable admin env', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'ci-placeholder-service-role-key'

    expect(hasSupabaseAdminEnv()).toBe(false)
  })

  it('accepts non-placeholder hosted Supabase admin env', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-e2e'

    expect(hasSupabaseAdminEnv()).toBe(true)
  })

  it('requires a service-role key', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    process.env.SUPABASE_URL = 'https://project.supabase.co'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    expect(hasSupabaseAdminEnv()).toBe(false)
  })
})
