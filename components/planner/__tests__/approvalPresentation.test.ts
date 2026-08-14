import {
  approvalActionLabel,
  getApprovalPresentation,
  readApprovalUiState,
} from '../approvalPresentation'
import type { ApprovalUiStatus } from '@/lib/planner/approvalUiState'

describe('approval presentation contract', () => {
  it.each([
    ['pending', 'Pending review', 'info'],
    ['authorized', 'Authorized', 'success'],
    ['executing', 'Executing', 'warning'],
    ['succeeded', 'Succeeded', 'success'],
    ['failed', 'Failed', 'danger'],
    ['expired', 'Expired', 'warning'],
    ['reapproval_required', 'Re-approval required', 'warning'],
    ['rejected', 'Rejected', 'neutral'],
    ['cancelled', 'Cancelled', 'neutral'],
    ['superseded', 'Superseded', 'neutral'],
  ] as Array<[ApprovalUiStatus, string, string]>) (
    'gives %s exactly one label and tone',
    (status, label, tone) => {
      expect(getApprovalPresentation(status)).toEqual(expect.objectContaining({ label, tone }))
    }
  )

  it('uses explicit API state and actions instead of collapsing failed to pending', () => {
    expect(readApprovalUiState({
      status: 'authorized',
      uiStatus: 'failed',
      availableActions: ['retry'],
    })).toEqual({
      status: 'failed',
      availableActions: ['retry'],
      isTerminal: false,
    })
    expect(approvalActionLabel('retry')).toBe('Retry')
  })

  it('derives expired and re-approval action states from legacy rows', () => {
    expect(readApprovalUiState({
      status: 'pending',
      expires_at: '2026-07-09T10:00:00.000Z',
    }, new Date('2026-07-09T11:00:00.000Z'))).toEqual(expect.objectContaining({
      status: 'expired',
      availableActions: ['request_reapproval'],
    }))
    expect(readApprovalUiState({ status: 're_approval_required' })).toEqual(expect.objectContaining({
      status: 'reapproval_required',
      availableActions: ['request_reapproval'],
    }))
  })
})
