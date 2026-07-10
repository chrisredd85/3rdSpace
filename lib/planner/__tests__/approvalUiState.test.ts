import { deriveApprovalUiState, type ApprovalUiStatus } from '../approvalUiState'

const now = new Date('2026-07-09T18:00:00.000Z')

describe('deriveApprovalUiState', () => {
  it.each<{
    label: string
    input: Parameters<typeof deriveApprovalUiState>[0]
    status: ApprovalUiStatus
    actions: string[]
    terminal: boolean
  }>([
    { label: 'pending', input: { approvalStatus: 'pending' }, status: 'pending', actions: ['edit', 'authorize', 'cancel'], terminal: false },
    { label: 'authorized', input: { approvalStatus: 'authorized', actionStatus: 'approved' }, status: 'authorized', actions: [], terminal: false },
    { label: 'executing', input: { approvalStatus: 'approved', actionStatus: 'executing' }, status: 'executing', actions: [], terminal: false },
    { label: 'succeeded', input: { approvalStatus: 'authorized', actionStatus: 'complete', expiresAt: '2026-07-01T00:00:00Z', now }, status: 'succeeded', actions: [], terminal: true },
    { label: 'failed', input: { approvalStatus: 'approved', actionStatus: 'failed', now }, status: 'failed', actions: ['retry'], terminal: false },
    { label: 'expired', input: { approvalStatus: 'authorized', actionStatus: 'failed', expiresAt: '2026-07-01T00:00:00Z', now }, status: 'expired', actions: ['request_reapproval'], terminal: false },
    { label: 'reapproval required', input: { approvalStatus: 're_approval_required' }, status: 'reapproval_required', actions: ['request_reapproval'], terminal: false },
    { label: 'rejected', input: { approvalStatus: 'rejected' }, status: 'rejected', actions: [], terminal: true },
    { label: 'cancelled', input: { approvalStatus: 'cancelled' }, status: 'cancelled', actions: [], terminal: true },
    { label: 'superseded', input: { approvalStatus: 'pending', supersededAt: '2026-07-09T17:00:00Z' }, status: 'superseded', actions: [], terminal: true },
  ])('maps $label to exactly one state and action set', ({ input, status, actions, terminal }) => {
    expect(deriveApprovalUiState({ now, ...input })).toEqual({
      status,
      availableActions: actions,
      isTerminal: terminal,
    })
  })

  it('does not expose retry for a failed action without an executable approval', () => {
    expect(deriveApprovalUiState({ approvalStatus: 'pending', actionStatus: 'failed', now })).toEqual({
      status: 'pending',
      availableActions: ['edit', 'authorize', 'cancel'],
      isTerminal: false,
    })
  })
})
