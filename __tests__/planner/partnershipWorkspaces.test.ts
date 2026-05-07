import {
  applyPartnershipProgressionSnapshot,
  isBookedPartnerInviteEligible,
} from '@/lib/planner/partnershipWorkspaces'
import type { PartnershipWorkspace } from '@/lib/planner/partnershipWorkspaces'

describe('partnershipWorkspaces', () => {
  it('hides accepted invites until the deposit step is unblocked', () => {
    expect(
      isBookedPartnerInviteEligible({
        status: 'accepted',
        proposed_deposit_cents: 150_000,
        response_payload: {},
      })
    ).toBe(false)

    expect(
      isBookedPartnerInviteEligible({
        status: 'accepted',
        proposed_deposit_cents: 150_000,
        response_payload: { deposit_step_unblocked: true },
      })
    ).toBe(true)
  })

  it('simulates accept to deposit to contract upload progression', () => {
    const workspace: Pick<
      PartnershipWorkspace,
      'payment_status' | 'milestones' | 'documents' | 'next_required_action'
    > = {
      payment_status: {
        label: 'Deposit ready',
        deposit_cents: 150_000,
        is_deposit_paid: false,
      },
      milestones: [
        {
          id: 'milestone-terms',
          thread_id: 'thread-1',
          label: 'Terms accepted',
          due_date: '2026-06-01',
          completed_at: '2026-05-05T10:00:00.000Z',
          created_at: '2026-05-05T10:00:00.000Z',
        },
        {
          id: 'milestone-deposit',
          thread_id: 'thread-1',
          label: 'Deposit placed',
          due_date: null,
          completed_at: null,
          created_at: '2026-05-05T10:00:00.000Z',
        },
        {
          id: 'milestone-contract',
          thread_id: 'thread-1',
          label: 'Contract uploaded',
          due_date: null,
          completed_at: null,
          created_at: '2026-05-05T10:00:00.000Z',
        },
      ],
      documents: [],
      next_required_action: 'Place deposit',
    }

    const afterDeposit = applyPartnershipProgressionSnapshot(workspace, 'mark_deposit_placed')
    expect(afterDeposit.payment_status.label).toBe('Deposit placed')
    expect(afterDeposit.next_required_action).toBe('Upload contract')

    const afterContract = applyPartnershipProgressionSnapshot(afterDeposit, 'upload_contract')
    expect(afterContract.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'contract',
        }),
      ])
    )
    expect(afterContract.next_required_action).toBe('Confirm day-of logistics')
  })
})
