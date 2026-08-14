import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  approvalRequiresReapproval,
  buildApprovalSnapshotHash,
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
  buildLegacyPlanApprovalSnapshotHash,
} from '../reapproval'

const basePlan = {
  event_type: 'mixer',
  guest_count: 100,
  budget_cap_cents: 500_000,
  neighborhood: 'Mission',
  date_window_start: '2026-08-01',
  date_window_end: '2026-08-01',
  ticketed: true,
  ticketing_model: 'paid',
  food_responsibility: 'venue',
  profit_goal_cents: 100_000,
}

const baseApproval = {
  action_label: 'Authorize Mission Hall',
  event_date: '2026-08-01',
  price_cents: 125_000,
  fees_cents: 5_000,
  requested_amount_cents: 130_000,
  provider: 'Mission Hall',
  refund_terms: 'Refundable until 14 days out',
  cancellation_terms: 'Cancel before contract signing',
  package_details: 'Private room for 100 guests',
  delivery_email: 'events@mission-hall.example',
  notes: 'Use the patio if available.',
  expires_at: '2026-07-20T18:00:00.000Z',
}

const baseAction = {
  action_type: 'hold_request',
  target_type: 'venue',
  target_id: '550e8400-e29b-41d4-a716-446655440004',
  amount_cents: 130_000,
  payload_json: {
    venue_ids: ['550e8400-e29b-41d4-a716-446655440004'],
    seats: 100,
    terms: { minimum_spend_cents: 125_000 },
  },
}

describe('approval re-approval snapshots', () => {
  it('keeps current approvals fresh', () => {
    const hash = buildApprovalSnapshotHash({
      plan: basePlan,
      approval: baseApproval,
      action: baseAction,
    })

    expect(approvalRequiresReapproval({
      plan: basePlan,
      approval: baseApproval,
      action: baseAction,
      storedSnapshotHash: hash,
    })).toBe(false)
  })

  it.each([null, undefined, '', '   '])(
    'requires re-approval when the stored snapshot evidence is %p',
    (storedSnapshotHash) => {
      expect(approvalRequiresReapproval({
        plan: basePlan,
        approval: baseApproval,
        action: baseAction,
        storedSnapshotHash,
      })).toBe(true)
    }
  )

  it('requires re-approval when seats, price, venue, or terms change', () => {
    const hash = buildApprovalSnapshotHash({
      plan: basePlan,
      approval: baseApproval,
      action: baseAction,
    })

    expect(approvalRequiresReapproval({
      plan: { ...basePlan, guest_count: 125 },
      approval: baseApproval,
      action: baseAction,
      storedSnapshotHash: hash,
    })).toBe(true)
    expect(approvalRequiresReapproval({
      plan: basePlan,
      approval: { ...baseApproval, requested_amount_cents: 150_000 },
      action: baseAction,
      storedSnapshotHash: hash,
    })).toBe(true)
    expect(approvalRequiresReapproval({
      plan: basePlan,
      approval: baseApproval,
      action: { ...baseAction, target_id: '550e8400-e29b-41d4-a716-446655440005' },
      storedSnapshotHash: hash,
    })).toBe(true)
    expect(approvalRequiresReapproval({
      plan: basePlan,
      approval: baseApproval,
      action: {
        ...baseAction,
        payload_json: { ...baseAction.payload_json, terms: { minimum_spend_cents: 150_000 } },
      },
      storedSnapshotHash: hash,
    })).toBe(true)
  })

  it('allows legacy plan-only approval hashes when the plan is unchanged', () => {
    const legacyHash = buildLegacyPlanApprovalSnapshotHash({ plan: basePlan })

    expect(approvalRequiresReapproval({
      plan: basePlan,
      approval: baseApproval,
      action: baseAction,
      storedSnapshotHash: legacyHash,
    })).toBe(false)
  })

  it('builds a full v2 confirmation snapshot with exact cents, date, notes, and counterparty', () => {
    const snapshot = buildApprovalSnapshotV2({
      plan: basePlan,
      approval: { ...baseApproval, requested_amount_cents: 9_550 },
      action: {
        ...baseAction,
        amount_cents: 9_550,
        payload_json: {
          ...baseAction.payload_json,
          target_name: 'Mission Hall',
          delivery_email: 'events@mission-hall.example',
        },
      },
    })

    expect(snapshot).toEqual(expect.objectContaining({
      schema_version: APPROVAL_SNAPSHOT_SCHEMA_VERSION,
      approval: expect.objectContaining({
        requested_amount_cents: 9_550,
        event_date: '2026-08-01',
        notes: 'Use the patio if available.',
      }),
      counterparty: expect.objectContaining({
        display_name: 'Mission Hall',
        delivery_email: 'events@mission-hall.example',
      }),
      action: expect.objectContaining({ amount_cents: 9_550 }),
    }))
  })

  it('hashes every v2 confirmation field while preserving v1 compatibility by default', () => {
    const input = { plan: basePlan, approval: baseApproval, action: baseAction }
    const hash = buildApprovalSnapshotHashV2(input)

    expect(approvalRequiresReapproval({
      ...input,
      storedSnapshotHash: hash,
      storedSnapshotVersion: 2,
    })).toBe(false)
    expect(approvalRequiresReapproval({
      ...input,
      approval: { ...baseApproval, notes: 'Use the indoor room.' },
      storedSnapshotHash: hash,
      storedSnapshotVersion: 2,
    })).toBe(true)
    expect(approvalRequiresReapproval({
      ...input,
      approval: { ...baseApproval, requested_amount_cents: 9_550 },
      storedSnapshotHash: hash,
      storedSnapshotVersion: 2,
    })).toBe(true)
  })
})
