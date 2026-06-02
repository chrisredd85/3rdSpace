import type { createServiceRoleClient } from './server'

export type SupabaseDbClient = ReturnType<typeof createServiceRoleClient>
export type SupabaseDb = Pick<SupabaseDbClient, 'from'>
