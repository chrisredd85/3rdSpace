/**
 * @jest-environment node
 */
const {
  API_HEADERS,
  ISSUE_MARKER,
  classifyFailure,
  collectFailures,
  reconcileIntakeEvalIssue,
} = require('../../.github/scripts/reconcile-intake-eval-issue.cjs')

const context = {
  serverUrl: 'https://github.com',
  repo: { owner: 'chrisredd85', repo: '3rdSpace' },
  runId: 12345,
  sha: 'abc123',
}

const successfulOutcomes = {
  configuration: 'success',
  checkout: 'success',
  setup: 'success',
  install: 'success',
  history: 'success',
  eval: 'success',
  historyArtifact: 'success',
  diagnosticsArtifact: 'success',
}

const successfulMetrics = {
  matchRate: '0.95',
  threshold: '0.9',
  matched: '19',
  total: '20',
}

const artifactUrls = {
  history: 'https://github.com/history-artifact',
  diagnostics: 'https://github.com/diagnostics-artifact',
}

function createHarness(issues: Array<Record<string, unknown>> = []) {
  const github = {
    paginate: jest.fn().mockResolvedValue(issues),
    rest: {
      issues: {
        listForRepo: jest.fn(),
        create: jest.fn().mockResolvedValue({ data: { number: 77 } }),
        update: jest.fn().mockResolvedValue({ data: {} }),
        createComment: jest.fn().mockResolvedValue({ data: {} }),
      },
    },
  }
  const core = {
    notice: jest.fn(),
    warning: jest.fn(),
  }

  return { github, core }
}

describe('intake eval issue reconciliation', () => {
  it('classifies configuration and real threshold failures separately', () => {
    expect(
      classifyFailure({
        jobResult: 'failure',
        evalResult: '',
        outcomes: { ...successfulOutcomes, configuration: 'failure', eval: '' },
      }),
    ).toBe('configuration')
    expect(
      classifyFailure({
        jobResult: 'failure',
        evalResult: 'threshold_failure',
        outcomes: { ...successfulOutcomes, eval: 'failure' },
      }),
    ).toBe('threshold')
    expect(
      classifyFailure({
        jobResult: 'failure',
        evalResult: 'execution_error',
        outcomes: { ...successfulOutcomes, eval: 'failure', historyArtifact: 'skipped' },
      }),
    ).toBe('evaluation_runtime')
  })

  it('does not mistake restored history for a current report after a runtime failure', () => {
    expect(
      classifyFailure({
        jobResult: 'failure',
        evalResult: 'execution_error',
        outcomes: {
          ...successfulOutcomes,
          eval: 'failure',
          historyArtifact: 'success',
          diagnosticsArtifact: 'success',
        },
      }),
    ).toBe('evaluation_runtime')
  })

  it('reports concurrent threshold and artifact failures without masking either one', () => {
    expect(
      collectFailures({
        jobResult: 'failure',
        evalResult: 'threshold_failure',
        outcomes: {
          ...successfulOutcomes,
          eval: 'failure',
          historyArtifact: 'failure',
        },
      }),
    ).toEqual(['threshold', 'artifact'])
  })

  it('creates one configuration incident without claiming model drift', async () => {
    const { github, core } = createHarness()
    const result = await reconcileIntakeEvalIssue({
      github,
      context,
      core,
      jobResult: 'failure',
      evalResult: '',
      metrics: {},
      artifactUrls: { history: '', diagnostics: '' },
      outcomes: {
        ...successfulOutcomes,
        configuration: 'failure',
        checkout: '',
        setup: '',
        install: '',
        history: '',
        eval: '',
        historyArtifact: '',
        diagnosticsArtifact: '',
      },
    })

    expect(result).toEqual({ action: 'created', issueNumber: 77, failureKind: 'configuration' })
    expect(github.rest.issues.create).toHaveBeenCalledTimes(1)
    const request = github.rest.issues.create.mock.calls[0][0]
    expect(request.body).toContain(ISSUE_MARKER)
    expect(request.body).toContain('No phrase score was computed')
    expect(request.body).toContain('OPENAI_API_KEY_EVAL')
    expect(request.body).not.toContain('model drift detected')
    expect(request.headers).toEqual(API_HEADERS)
  })

  it('updates an existing incident instead of creating a duplicate', async () => {
    const incident = {
      number: 12,
      title: 'Intake phrase eval monitor failing',
      body: `${ISSUE_MARKER}\nold run`,
      state: 'open',
      updated_at: '2026-08-10T00:00:00Z',
    }
    const pullRequest = {
      number: 99,
      title: 'Unrelated PR',
      body: ISSUE_MARKER,
      state: 'open',
      updated_at: '2026-08-11T00:00:00Z',
      pull_request: { url: 'https://example.com' },
    }
    const { github, core } = createHarness([pullRequest, incident])
    const result = await reconcileIntakeEvalIssue({
      github,
      context,
      core,
      jobResult: 'failure',
      evalResult: 'threshold_failure',
      metrics: successfulMetrics,
      artifactUrls,
      outcomes: { ...successfulOutcomes, eval: 'failure' },
    })

    expect(result).toEqual({ action: 'updated', issueNumber: 12, failureKind: 'threshold' })
    expect(github.rest.issues.create).not.toHaveBeenCalled()
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 12, headers: API_HEADERS }),
    )
    const request = github.rest.issues.update.mock.calls[0][0]
    expect(request.body).toContain('Match rate:** 95.0%')
    expect(request.body).toContain('eval log and run metadata')
  })

  it('reopens the canonical incident when a failure recurs', async () => {
    const { github, core } = createHarness([
      {
        number: 12,
        title: 'Intake phrase eval monitor failing',
        body: ISSUE_MARKER,
        state: 'closed',
        updated_at: '2026-08-10T00:00:00Z',
      },
    ])
    const result = await reconcileIntakeEvalIssue({
      github,
      context,
      core,
      jobResult: 'failure',
      evalResult: 'passed',
      metrics: successfulMetrics,
      artifactUrls,
      outcomes: { ...successfulOutcomes, history: 'failure' },
    })

    expect(result.action).toBe('reopened')
    expect(github.rest.issues.update).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 12,
        state: 'open',
        state_reason: 'reopened',
        headers: API_HEADERS,
      }),
    )
  })

  it('comments on and closes every open monitor incident after recovery', async () => {
    const { github, core } = createHarness([
      {
        number: 12,
        title: 'Intake phrase eval monitor failing',
        body: ISSUE_MARKER,
        state: 'open',
        updated_at: '2026-08-10T00:00:00Z',
      },
      {
        number: 13,
        title: 'Intake phrase eval drift detected',
        body: 'legacy issue',
        state: 'open',
        updated_at: '2026-08-09T00:00:00Z',
      },
    ])
    const result = await reconcileIntakeEvalIssue({
      github,
      context,
      core,
      jobResult: 'success',
      evalResult: 'passed',
      metrics: successfulMetrics,
      artifactUrls,
      outcomes: successfulOutcomes,
    })

    expect(result.action).toBe('closed')
    expect(github.rest.issues.createComment).toHaveBeenCalledTimes(2)
    expect(github.rest.issues.update).toHaveBeenCalledTimes(2)
    for (const [request] of github.rest.issues.update.mock.calls) {
      expect(request).toEqual(
        expect.objectContaining({ state: 'closed', state_reason: 'completed', headers: API_HEADERS }),
      )
    }
  })
})
