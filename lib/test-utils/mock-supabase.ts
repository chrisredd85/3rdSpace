import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Creates a mock Supabase client for testing
 */
export function createMockSupabaseClient(): Partial<SupabaseClient> {
  const mockData: Record<string, any[]> = {}

  return {
    from: jest.fn((table: string) => ({
      select: jest.fn((columns?: string) => ({
        eq: jest.fn((column: string, value: any) => ({
          single: jest.fn(() => Promise.resolve({ data: null, error: null })),
          order: jest.fn(() => ({
            range: jest.fn(() => Promise.resolve({ data: [], error: null })),
            limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
          })),
          limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        single: jest.fn(() => Promise.resolve({ data: null, error: null })),
        order: jest.fn(() => ({
          range: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        range: jest.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      insert: jest.fn((data: any) => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data, error: null })),
        })),
      })),
      update: jest.fn((data: any) => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data, error: null })),
          })),
        })),
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    })),
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      signInWithPassword: jest.fn(() => Promise.resolve({ data: { user: null, session: null }, error: null })),
      signUp: jest.fn(() => Promise.resolve({ data: { user: null, session: null }, error: null })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(() => Promise.resolve({ data: { path: 'test-path' }, error: null })),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/image.jpg' } })),
        remove: jest.fn(() => Promise.resolve({ data: null, error: null })),
      })),
    },
  } as any
}
