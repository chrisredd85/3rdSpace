import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerApprovalCard } from '../PlannerConversation'

const oldApprovalId = '11111111-1111-4111-8111-111111111111'
const newApprovalId = '22222222-2222-4222-8222-222222222222'

describe('PlannerApprovalCard', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('persists every edit as a new pending version, then separately authorizes the exact snapshot', async () => {
    const user = userEvent.setup()
    const onStatusChange = jest.fn()
    const onToast = jest.fn()
    const commandBodies: Array<Record<string, unknown>> = []

    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true, freeEventsRemaining: 0 } })
      }

      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      commandBodies.push(body)
      if (body.command === 'edit') {
        return jsonResponse({
          approval: {
            id: newApprovalId,
            status: 'pending',
            action_label: 'Reserve Moongate Lounge',
            provider: 'Moongate Lounge',
            requested_amount_cents: 9550,
            event_date: '2026-08-22',
            notes: 'Use the courtyard entrance.',
            snapshot_hash: 'snapshot-v2',
            version_number: 2,
            supersedes_approval_id: oldApprovalId,
          },
          confirmationSnapshot: {
            counterparty: 'Moongate Lounge',
            requestedAmountCents: 9550,
            eventDate: '2026-08-22',
            notes: 'Use the courtyard entrance.',
            snapshotHash: 'snapshot-v2',
          },
          uiStatus: 'pending',
          availableActions: ['edit', 'authorize', 'cancel'],
        })
      }

      if (body.command === 'authorize') {
        return jsonResponse({
          approval: {
            id: newApprovalId,
            status: 'authorized',
            action_label: 'Reserve Moongate Lounge',
            provider: 'Moongate Lounge',
            requested_amount_cents: 9550,
            authorized_amount_cents: 9550,
            event_date: '2026-08-22',
            notes: 'Use the courtyard entrance.',
            snapshot_hash: 'snapshot-v2',
          },
          actionStatus: 'executing',
          confirmationSnapshot: {
            counterparty: 'Moongate Lounge',
            requestedAmountCents: 9550,
            eventDate: '2026-08-22',
            notes: 'Use the courtyard entrance.',
            snapshotHash: 'snapshot-v2',
          },
          uiStatus: 'executing',
          availableActions: [],
        })
      }

      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'pending',
        action_label: 'Reserve Moongate Lounge',
        provider: 'Moongate Lounge',
        requested_amount_cents: 9550,
        event_date: '2026-08-20',
        notes: 'Original note.',
        snapshot_hash: 'snapshot-v1',
        available_actions: ['edit', 'authorize', 'cancel'],
      },
      onStatusChange,
      onToast,
    })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Proposed amount ($)')).toHaveValue('95.50')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-22' } })
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Use the courtyard entrance.' } })
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(commandBodies).toEqual([{
      approvalId: oldApprovalId,
      command: 'edit',
      expectedSnapshotHash: 'snapshot-v1',
      changes: {
        requestedAmountCents: 9550,
        eventDate: '2026-08-22',
        notes: 'Use the courtyard entrance.',
      },
    }])
    expect(onStatusChange).toHaveBeenCalledWith(
      oldApprovalId,
      'pending',
      expect.objectContaining({ id: newApprovalId, snapshot_hash: 'snapshot-v2' })
    )
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Changes saved for review',
    }))

    await user.click(await screen.findByRole('button', { name: 'Review authorization' }))
    expect(screen.getByText('$95.50')).toBeInTheDocument()
    expect(screen.getByText('2026-08-22')).toBeInTheDocument()
    expect(screen.getByText('Use the courtyard entrance.')).toBeInTheDocument()
    expect(screen.getAllByText('Moongate Lounge').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Authorize exact snapshot' }))

    await waitFor(() => expect(commandBodies).toHaveLength(2))
    expect(commandBodies[1]).toEqual({
      approvalId: newApprovalId,
      command: 'authorize',
      expectedSnapshotHash: 'snapshot-v2',
    })
    expect(commandBodies[1]).not.toHaveProperty('authorizedAmountCents')
    expect(await screen.findByText('Executing')).toBeInTheDocument()
    expect(onStatusChange).toHaveBeenLastCalledWith(
      newApprovalId,
      'executing',
      expect.objectContaining({ id: newApprovalId, snapshot_hash: 'snapshot-v2' })
    )
  })

  it('renders failed truth and retries with a stable idempotency key and snapshot hash', async () => {
    const user = userEvent.setup()
    const retryRequests: RequestInit[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      if (url.endsWith(`/approvals/${oldApprovalId}/retry`)) {
        retryRequests.push(init ?? {})
        return jsonResponse({
          approval: {
            id: oldApprovalId,
            status: 'authorized',
            requested_amount_cents: 9550,
            authorized_amount_cents: 9550,
            snapshot_hash: 'snapshot-failed',
          },
          actionStatus: 'complete',
          actionResult: { message: 'Venue hold confirmed once.' },
          uiStatus: 'succeeded',
          availableActions: [],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'authorized',
        ui_status: 'failed',
        action_status: 'failed',
        action_label: 'Reserve venue',
        provider: 'Moongate Lounge',
        requested_amount_cents: 9550,
        authorized_amount_cents: 9550,
        snapshot_hash: 'snapshot-failed',
        available_actions: ['retry'],
      },
    })

    expect(screen.getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(retryRequests).toHaveLength(1))
    expect(retryRequests[0].headers).toEqual(expect.objectContaining({
      'Idempotency-Key': expect.stringMatching(new RegExp(`^approval-retry:${oldApprovalId}:`)),
    }))
    expect(JSON.parse(String(retryRequests[0].body))).toEqual({
      expectedSnapshotHash: 'snapshot-failed',
    })
    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('Venue hold confirmed once.')).toBeInTheDocument()
  })

  it.each([
    [502, 'approval_retry_failed'],
    [409, 'retry_prior_failure'],
  ] as const)('applies terminal retry failure %s/%s and rotates the key for the next deliberate retry', async (failureStatus, failureCode) => {
    const user = userEvent.setup()
    const retryKeys: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      if (url.endsWith(`/approvals/${oldApprovalId}/retry`)) {
        const headers = init?.headers as Record<string, string>
        retryKeys.push(headers['Idempotency-Key'])
        if (retryKeys.length === 1) {
          return jsonResponse({
            error: 'Provider timed out after a known failed attempt.',
            approval: {
              id: oldApprovalId,
              status: 'authorized',
              snapshot_hash: 'snapshot-failed',
            },
            actionStatus: 'failed',
            actionResult: { message: 'Provider confirmed that no hold was created.' },
            uiStatus: 'failed',
            availableActions: ['retry'],
            code: failureCode,
          }, failureStatus)
        }
        return jsonResponse({
          approval: {
            id: oldApprovalId,
            status: 'authorized',
            snapshot_hash: 'snapshot-failed',
          },
          actionStatus: 'complete',
          uiStatus: 'succeeded',
          availableActions: [],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'authorized',
        ui_status: 'failed',
        action_status: 'failed',
        action_label: 'Reserve venue',
        snapshot_hash: 'snapshot-failed',
        available_actions: ['retry'],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Provider confirmed that no hold was created.')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(retryKeys).toHaveLength(2))
    expect(retryKeys[1]).not.toBe(retryKeys[0])
    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
  })

  it('applies a structured authorization failure before leaving confirmation mode', async () => {
    const user = userEvent.setup()
    const onStatusChange = jest.fn()
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      return jsonResponse({
        error: 'Gmail provider rejected the send.',
        code: 'approval_execution_failed',
        approval: {
          id: oldApprovalId,
          status: 'authorized',
          requested_amount_cents: 9550,
          authorized_amount_cents: 9550,
          snapshot_hash: 'snapshot-failed',
        },
        actionStatus: 'failed',
        actionResult: { error: 'No outreach message was sent.' },
        uiStatus: 'failed',
        availableActions: ['retry'],
      }, 502)
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'pending',
        action_label: 'Send venue outreach',
        provider: 'Moongate Lounge',
        requested_amount_cents: 9550,
        snapshot_hash: 'snapshot-failed',
        available_actions: ['edit', 'authorize', 'cancel'],
      },
      onStatusChange,
    })

    await user.click(await screen.findByRole('button', { name: 'Review authorization' }))
    await user.click(screen.getByRole('button', { name: 'Authorize exact snapshot' }))

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('No outreach message was sent.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByText('Confirm exact snapshot')).not.toBeInTheDocument()
    expect(onStatusChange).toHaveBeenCalledWith(
      oldApprovalId,
      'failed',
      expect.objectContaining({ action_status: 'failed', ui_status: 'failed' })
    )
  })

  it('keeps the retry key stable after transport ambiguity', async () => {
    const user = userEvent.setup()
    const retryKeys: string[] = []
    let retryCount = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      if (url.endsWith(`/approvals/${oldApprovalId}/retry`)) {
        retryCount += 1
        retryKeys.push((init?.headers as Record<string, string>)['Idempotency-Key'])
        if (retryCount === 1) throw new TypeError('Network connection lost')
        return jsonResponse({
          approval: {
            id: oldApprovalId,
            status: 'authorized',
            snapshot_hash: 'snapshot-ambiguous',
          },
          actionStatus: 'complete',
          actionResult: { message: 'Provider result reconciled.' },
          uiStatus: 'succeeded',
          availableActions: [],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'authorized',
        ui_status: 'failed',
        action_status: 'failed',
        action_label: 'Send venue outreach',
        snapshot_hash: 'snapshot-ambiguous',
        available_actions: ['retry'],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Network connection lost')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(retryKeys).toHaveLength(2))
    expect(retryKeys[1]).toBe(retryKeys[0])
    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
  })

  it('keeps the retry key stable while a 202 attempt is in progress', async () => {
    const user = userEvent.setup()
    const retryKeys: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      if (url.endsWith(`/approvals/${oldApprovalId}/retry`)) {
        retryKeys.push((init?.headers as Record<string, string>)['Idempotency-Key'])
        if (retryKeys.length === 1) {
          return jsonResponse({
            approval: {
              id: oldApprovalId,
              status: 'authorized',
              snapshot_hash: 'snapshot-in-progress',
            },
            actionStatus: 'executing',
            uiStatus: 'executing',
            availableActions: [],
            code: 'retry_in_progress',
            message: 'This retry is already in progress.',
          }, 202)
        }
        return jsonResponse({
          approval: {
            id: oldApprovalId,
            status: 'authorized',
            snapshot_hash: 'snapshot-in-progress',
          },
          actionStatus: 'complete',
          uiStatus: 'succeeded',
          availableActions: [],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    const failedApproval = {
      id: oldApprovalId,
      status: 'authorized',
      ui_status: 'failed',
      action_status: 'failed',
      action_label: 'Send venue outreach',
      snapshot_hash: 'snapshot-in-progress',
      snapshot_schema_version: 2,
      available_actions: ['retry'],
    }
    const rendered = renderApprovalCard({ approvalId: oldApprovalId, approval: failedApproval })

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Executing')).toBeInTheDocument()

    rendered.rerender(
      <PlannerApprovalCard
        planId="plan-1"
        approvalId={oldApprovalId}
        approval={{ ...failedApproval }}
        isAuthenticated
        onAuthRequired={jest.fn()}
        onStatusChange={jest.fn()}
        onToast={jest.fn()}
      />
    )
    await user.click(await screen.findByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(retryKeys).toHaveLength(2))
    expect(retryKeys[1]).toBe(retryKeys[0])
    expect(await screen.findByText('Succeeded')).toBeInTheDocument()
  })

  it('requests a fresh version for expired approvals instead of rendering them as pending', async () => {
    const user = userEvent.setup()
    let requestBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return jsonResponse({
        approval: {
          id: newApprovalId,
          status: 'pending',
          action_label: 'Reserve venue',
          snapshot_hash: 'snapshot-fresh',
        },
        uiStatus: 'pending',
        availableActions: ['edit', 'authorize', 'cancel'],
      })
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'expired',
        action_label: 'Reserve venue',
        snapshot_hash: 'snapshot-expired',
        available_actions: ['request_reapproval'],
      },
    })

    expect(screen.getByText('Expired')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Request re-approval' }))

    await waitFor(() => expect(requestBody).not.toBeNull())
    expect(requestBody).toEqual({
      approvalId: oldApprovalId,
      command: 'request_reapproval',
      expectedSnapshotHash: 'snapshot-expired',
    })
    expect(await screen.findByText('Pending review')).toBeInTheDocument()
  })

  it('upgrades a legacy expired approval with no snapshot hash through re-approval', async () => {
    const user = userEvent.setup()
    let requestBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return jsonResponse({
        approval: {
          id: newApprovalId,
          status: 'pending',
          action_label: 'Reserve venue',
          snapshot_hash: 'snapshot-upgraded',
        },
        uiStatus: 'pending',
        availableActions: ['edit', 'authorize', 'cancel'],
      })
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'expired',
        action_label: 'Reserve venue',
        snapshot_hash: null,
        available_actions: ['request_reapproval'],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Request re-approval' }))

    await waitFor(() => expect(requestBody).not.toBeNull())
    expect(requestBody).toEqual({
      approvalId: oldApprovalId,
      command: 'request_reapproval',
      expectedSnapshotHash: null,
    })
    expect(await screen.findByText('Pending review')).toBeInTheDocument()
  })

  it('routes a legacy pending snapshot through re-approval instead of edit or authorization', async () => {
    const user = userEvent.setup()
    const legacyHash = 'a'.repeat(64)
    let requestBody: Record<string, unknown> | null = null
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/builder/billing/status') {
        return jsonResponse({ billing: { canCreateEvent: true } })
      }
      requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return jsonResponse({
        approval: {
          id: newApprovalId,
          status: 'pending',
          action_label: 'Reserve venue',
          snapshot_hash: 'b'.repeat(64),
          snapshot_schema_version: 2,
        },
        uiStatus: 'pending',
        availableActions: ['edit', 'authorize', 'cancel'],
      })
    }) as jest.Mock

    renderApprovalCard({
      approvalId: oldApprovalId,
      approval: {
        id: oldApprovalId,
        status: 'pending',
        action_label: 'Reserve venue',
        snapshot_hash: legacyHash,
        snapshot_schema_version: null,
        available_actions: ['edit', 'authorize', 'cancel'],
      },
    })

    expect(screen.queryByRole('button', { name: 'Review authorization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Request re-approval' }))

    await waitFor(() => expect(requestBody).not.toBeNull())
    expect(requestBody).toEqual({
      approvalId: oldApprovalId,
      command: 'request_reapproval',
      expectedSnapshotHash: legacyHash,
    })
    expect(await screen.findByRole('button', { name: 'Review authorization' })).toBeEnabled()
  })
})

function renderApprovalCard({
  approvalId,
  approval,
  onStatusChange = jest.fn(),
  onToast = jest.fn(),
}: {
  approvalId: string
  approval: Record<string, unknown>
  onStatusChange?: jest.Mock
  onToast?: jest.Mock
}) {
  const approvalWithSchema = Object.prototype.hasOwnProperty.call(approval, 'snapshot_schema_version')
    ? approval
    : { snapshot_schema_version: 2, ...approval }

  return render(
    <PlannerApprovalCard
      planId="plan-1"
      approvalId={approvalId}
      approval={approvalWithSchema}
      isAuthenticated
      onAuthRequired={jest.fn()}
      onStatusChange={onStatusChange}
      onToast={onToast}
    />
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
