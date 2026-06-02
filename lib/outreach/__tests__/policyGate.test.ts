jest.mock('server-only', () => ({}))

import { canActAutonomously } from '@/lib/outreach/policyGate'

const basePolicy = {
  id: 'policy-1',
  user_id: 'user-1',
  version: 1,
  max_unattended_budget_cents: 500000,
  allowed_autonomous_actions: ['send_follow_up', 'reply_to_needs_info'],
  quiet_hours_start_local: null,
  quiet_hours_end_local: null,
  max_inquiries_per_event: 20,
  max_followups_per_thread: 2,
  blacklisted_venue_ids: [],
  blacklisted_keywords: [],
  require_approval_for_first_contact: true,
  irreversible_autonomous_actions: [],
  trust_level: 85,
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
}

describe('canActAutonomously', () => {
  it('defaults new creators to zero autonomy when no policy exists', async () => {
    const result = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [] }),
      userId: 'user-1',
      action: 'send_follow_up',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no_policy')
  })

  it('allows a low-stakes action inside explicit creator policy', async () => {
    const result = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [basePolicy] }),
      userId: 'user-1',
      action: 'send_follow_up',
      context: { followUpCount: 1, priceCents: 0 },
    })

    expect(result.allowed).toBe(true)
    expect(result.policy?.version).toBe(1)
  })

  it('blocks above-cap quotes and legal commitments', async () => {
    const quote = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [basePolicy] }),
      userId: 'user-1',
      action: 'reply_to_needs_info',
      context: { priceCents: 600000 },
    })
    const legal = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [basePolicy] }),
      userId: 'user-1',
      action: 'send_follow_up',
      context: { legalCommitment: true },
    })

    expect(quote.allowed).toBe(false)
    expect(quote.reason).toBe('price_above_unattended_budget_cap')
    expect(legal.allowed).toBe(false)
    expect(legal.reason).toBe('high_stakes_action_requires_creator')
  })

  it('honors quiet hours and blacklist rules', async () => {
    const policy = {
      ...basePolicy,
      quiet_hours_start_local: '22:00:00',
      quiet_hours_end_local: '07:00:00',
      blacklisted_keywords: ['exclusive terms'],
    }

    const quiet = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [policy] }),
      userId: 'user-1',
      action: 'send_follow_up',
      context: { now: new Date('2026-06-01T23:30:00') },
    })
    const keyword = await canActAutonomously({
      db: makeDb({ creator_outreach_policies: [{ ...policy, quiet_hours_start_local: null, quiet_hours_end_local: null }] }),
      userId: 'user-1',
      action: 'send_follow_up',
      context: { bodyText: 'Can you confirm exclusive terms?' },
    })

    expect(quiet.allowed).toBe(false)
    expect(quiet.reason).toBe('quiet_hours')
    expect(keyword.allowed).toBe(false)
    expect(keyword.reason).toBe('blacklisted_keyword')
  })
})

function makeDb(seed: Record<string, Array<Record<string, any>>>) {
  return {
    from(table: string) {
      return makeQuery(table, seed)
    },
  }
}

function makeQuery(table: string, seed: Record<string, Array<Record<string, any>>>) {
  const filters: Array<(row: Record<string, any>) => boolean> = []
  let rows = [...(seed[table] ?? [])]
  let limitCount: number | null = null

  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return query
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      rows = [...rows].sort((a, b) => {
        const left = a[column]
        const right = b[column]
        if (left === right) return 0
        const result = left > right ? 1 : -1
        return options?.ascending === false ? -result : result
      })
      return query
    },
    limit: (count: number) => {
      limitCount = count
      return query
    },
    maybeSingle: () => {
      const filtered = rows.filter((row) => filters.every((filter) => filter(row)))
      return Promise.resolve({ data: filtered.slice(0, limitCount ?? undefined)[0] ?? null, error: null })
    },
  }

  return query
}
