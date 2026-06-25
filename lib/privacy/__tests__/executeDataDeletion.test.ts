jest.mock('server-only', () => ({}))
jest.mock('@/lib/email', () => ({
  sendResendEmail: jest.fn().mockResolvedValue({ sent: true }),
}))
jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(),
}))

import { executeDataDeletion } from '@/lib/privacy/executeDataDeletion'
import { getStripeClient } from '@/lib/stripe/connect'

type Operation = {
  table: string
  action: string
  payload?: unknown
  filters: Array<[string, unknown]>
}

function createAdminMock(options: { failTable?: string } = {}) {
  const operations: Operation[] = []
  const authDeleteUser = jest.fn().mockResolvedValue({ error: null })

  const admin = {
    auth: {
      admin: {
        deleteUser: authDeleteUser,
      },
    },
    from: jest.fn((table: string) => {
      const makeQuery = (action: string, payload?: unknown) => {
        const operation: Operation = { table, action, payload, filters: [] }
        operations.push(operation)
        const result = () => ({
          data: null,
          error: options.failTable === table ? { message: `${table} failed` } : null,
          count: 1,
        })
        const query: any = {
          eq: jest.fn((column: string, value: unknown) => {
            operation.filters.push([column, value])
            return query
          }),
          in: jest.fn((column: string, value: unknown) => {
            operation.filters.push([column, value])
            return query
          }),
          maybeSingle: jest.fn(() => {
            if (table === 'builder_profiles') {
              return {
                data: { id: 'builder-1', stripe_customer_id: 'cus_test' },
                error: null,
              }
            }
            return { data: null, error: null }
          }),
          single: jest.fn(result),
          then: undefined,
        }
        return Object.assign(query, result())
      }

      return {
        select: jest.fn(() => {
          if (table === 'outreach_threads') {
            const operation: Operation = { table, action: 'select', filters: [] }
            operations.push(operation)
            const query: any = {
              eq: jest.fn((column: string, value: unknown) => {
                operation.filters.push([column, value])
                return { data: [{ id: 'thread-1' }, { id: 'thread-2' }], error: null }
              }),
            }
            return query
          }
          return makeQuery('select')
        }),
        delete: jest.fn(() => makeQuery('delete')),
        update: jest.fn((payload: unknown) => makeQuery('update', payload)),
        insert: jest.fn((payload: unknown) => makeQuery('insert', payload)),
      }
    }),
  }

  return { admin, operations, authDeleteUser }
}

describe('executeDataDeletion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getStripeClient as jest.Mock).mockReturnValue({
      customers: {
        del: jest.fn().mockResolvedValue({ id: 'cus_test', deleted: true }),
      },
    })
  })

  it('soft-deletes auth, deletes tokens, anonymizes app data, and retains financial ledgers', async () => {
    const { admin, operations, authDeleteUser } = createAdminMock()

    const result = await executeDataDeletion({
      supabase: admin as any,
      userId: 'user-1',
      adminUserId: 'admin-1',
    })

    expect(result.failed).toEqual([])
    expect(result.deleted).toEqual(expect.arrayContaining([
      'creator_email_accounts',
      'oauth_pending_connections',
      'builder_ticketing_connections',
      'stripe_customer',
      'auth.users_soft_delete',
    ]))
    expect(result.anonymized).toEqual(expect.arrayContaining([
      'builder_profiles',
      'public.users',
      'outreach_threads',
      'outreach_messages',
    ]))
    expect(result.retained).toEqual(expect.arrayContaining([
      'settlement_runs',
      'settlement_charges',
      'platform_fee_transactions',
      'audit_logs',
    ]))
    expect(authDeleteUser).toHaveBeenCalledWith('user-1', true)
    expect((getStripeClient as jest.Mock).mock.results[0].value.customers.del).toHaveBeenCalledWith('cus_test')
    expect(operations.some((operation) => operation.table === 'admin_audit_log' && operation.action === 'insert')).toBe(true)
  })

  it('keeps request in review shape by returning failed steps when a table update fails', async () => {
    const { admin } = createAdminMock({ failTable: 'builder_profiles' })

    const result = await executeDataDeletion({
      supabase: admin as any,
      userId: 'user-1',
      adminUserId: 'admin-1',
    })

    expect(result.failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'builder_profiles' }),
      ])
    )
  })
})
