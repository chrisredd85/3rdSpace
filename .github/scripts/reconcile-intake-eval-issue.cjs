'use strict'

const ISSUE_MARKER = '<!-- intake-phrase-eval-monitor -->'
const ISSUE_TITLE = 'Intake phrase eval monitor failing'
const LEGACY_ISSUE_TITLE = 'Intake phrase eval drift detected'
const API_HEADERS = Object.freeze({
  accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2026-03-10',
})

function collectFailures({ jobResult, outcomes, evalResult }) {
  if (outcomes.configuration === 'failure') return ['configuration']
  if (outcomes.configuration !== 'success') return ['workflow_unknown']
  if (outcomes.checkout === 'failure' || outcomes.setup === 'failure' || outcomes.install === 'failure') {
    return ['workflow_setup']
  }
  if (outcomes.checkout !== 'success' || outcomes.setup !== 'success' || outcomes.install !== 'success') {
    return ['workflow_unknown']
  }

  const failures = []
  if (outcomes.history === 'failure') failures.push('history')
  else if (outcomes.history !== 'success') failures.push('workflow_unknown')

  if (evalResult === 'threshold_failure') failures.push('threshold')
  else if (evalResult === 'execution_error' || evalResult === 'report_missing') {
    failures.push('evaluation_runtime')
  } else if (evalResult !== 'passed' || outcomes.eval !== 'success') {
    failures.push('workflow_unknown')
  }

  if (outcomes.historyArtifact === 'failure' || outcomes.diagnosticsArtifact === 'failure') {
    failures.push('artifact')
  }
  if (evalResult === 'passed') {
    if (
      !['success', 'failure'].includes(outcomes.historyArtifact) ||
      !['success', 'failure'].includes(outcomes.diagnosticsArtifact)
    ) {
      failures.push('workflow_unknown')
    }
  } else if (evalResult === 'threshold_failure') {
    if (
      !['success', 'failure'].includes(outcomes.historyArtifact) ||
      !['success', 'failure'].includes(outcomes.diagnosticsArtifact)
    ) {
      failures.push('workflow_unknown')
    }
  } else if (evalResult === 'execution_error' || evalResult === 'report_missing') {
    if (!['success', 'failure'].includes(outcomes.diagnosticsArtifact)) {
      failures.push('workflow_unknown')
    }
  }

  if (jobResult !== 'success' && failures.length === 0) failures.push('workflow_unknown')
  return [...new Set(failures)]
}

function classifyFailure(input) {
  return collectFailures(input)[0] ?? null
}

function runUrl(context) {
  return `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
}

function buildFailureBody({
  context,
  failureKinds,
  outcomes,
  evalResult,
  metrics = {},
  artifactUrls = {},
}) {
  const details = {
    configuration: [
      'Configuration failed before any model call. No phrase score was computed.',
      `Add a dedicated \`OPENAI_API_KEY_EVAL\` secret at ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/settings/secrets/actions.`,
    ],
    workflow_setup: [
      'The workflow failed while checking out the repository, setting up Node.js, or installing dependencies.',
      'Inspect the failing setup step before interpreting this as model drift.',
    ],
    history: [
      'The current eval was allowed to run, but the prior report history could not be restored.',
      'Repair Actions artifact access before relying on the rolling seven-day comparison.',
    ],
    threshold: [
      'The intake eval completed below its required match-rate threshold.',
      'Review the current report in the linked artifacts when available before changing planner prompts or archetype aliases.',
    ],
    evaluation_runtime: [
      'The intake eval failed before it produced a usable JSON report.',
      'Inspect the eval logs for an API, schema, or runtime error. This is not yet evidence of model drift.',
    ],
    artifact: [
      'One or more required history or diagnostics artifacts could not be uploaded.',
      'Repair artifact publication before relying on the rolling comparison or incident diagnostics.',
    ],
    workflow_unknown: [
      'The eval job failed without a recognized failed step outcome.',
      'Inspect the complete workflow log for a runner or cancellation edge case.',
    ],
  }

  const failureGuidance = failureKinds.flatMap((failureKind) => {
    const [summary, nextStep] = details[failureKind]
    return [`- **${failureKind}:** ${summary}`, `  ${nextStep}`]
  })
  const artifactLines = [
    artifactUrls.diagnostics
      ? `**Diagnostics:** [eval log and run metadata](${artifactUrls.diagnostics})`
      : '**Diagnostics:** unavailable',
    artifactUrls.history
      ? `**History:** [rolling JSON reports](${artifactUrls.history})`
      : '**History:** unavailable',
  ]
  const metricLines = metrics.matchRate
    ? [
        `**Match rate:** ${(Number(metrics.matchRate) * 100).toFixed(1)}%`,
        `**Threshold:** ${(Number(metrics.threshold) * 100).toFixed(1)}%`,
        `**Matched:** ${metrics.matched}/${metrics.total}`,
      ]
    : []

  return [
    ISSUE_MARKER,
    'The default-branch intake phrase monitor needs attention.',
    '',
    `**Failure types:** ${failureKinds.join(', ')}`,
    `**Eval result:** ${evalResult || 'not_started'}`,
    `**Latest run:** [${context.runId}](${runUrl(context)})`,
    `**Commit:** \`${context.sha}\``,
    ...artifactLines,
    ...metricLines,
    `**Step outcomes:** \`${JSON.stringify(outcomes)}\``,
    '',
    ...failureGuidance,
    '',
    'This issue is maintained automatically. Later failures update and reopen it in place, and a fully successful eval closes it.',
  ].join('\n')
}

async function findIncidents({ github, owner, repo }) {
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100,
    headers: API_HEADERS,
  })

  return issues
    .filter(
      (issue) =>
        !issue.pull_request &&
        ((typeof issue.body === 'string' && issue.body.includes(ISSUE_MARKER)) ||
          issue.title === ISSUE_TITLE ||
          issue.title === LEGACY_ISSUE_TITLE),
    )
    .sort((first, second) => String(second.updated_at).localeCompare(String(first.updated_at)))
}

async function closeDuplicate({ github, owner, repo, duplicate, canonicalNumber }) {
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: duplicate.number,
    body: `Superseded by #${canonicalNumber}.`,
    headers: API_HEADERS,
  })
  await github.rest.issues.update({
    owner,
    repo,
    issue_number: duplicate.number,
    state: 'closed',
    state_reason: 'not_planned',
    headers: API_HEADERS,
  })
}

async function reconcileIntakeEvalIssue({
  github,
  context,
  core,
  jobResult,
  outcomes,
  evalResult,
  metrics = {},
  artifactUrls = {},
}) {
  const owner = context.repo.owner
  const repo = context.repo.repo
  const failureKinds = collectFailures({ jobResult, outcomes, evalResult })
  const failureKind = failureKinds[0] ?? null
  const incidents = await findIncidents({ github, owner, repo })
  const openIncidents = incidents.filter((issue) => issue.state === 'open')
  const canonical = openIncidents[0] ?? incidents[0]

  if (!failureKind) {
    if (!openIncidents.length) {
      core.notice('The intake eval passed and no open monitor issue exists.')
      return { action: 'none', failureKind: null }
    }

    for (const issue of openIncidents) {
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: `Recovered in [workflow run ${context.runId}](${runUrl(context)}). Configuration, setup, history restore, evaluation, and artifact upload all succeeded.`,
        headers: API_HEADERS,
      })
      await github.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        state: 'closed',
        state_reason: 'completed',
        headers: API_HEADERS,
      })
    }
    core.notice(`Closed ${openIncidents.length} recovered intake eval issue(s).`)
    return { action: 'closed', issueNumber: openIncidents[0].number, failureKind: null }
  }

  const body = buildFailureBody({
    context,
    failureKinds,
    outcomes,
    evalResult,
    metrics,
    artifactUrls,
  })
  let canonicalNumber

  if (canonical) {
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: canonical.number,
      title: ISSUE_TITLE,
      body,
      ...(canonical.state === 'closed' ? { state: 'open', state_reason: 'reopened' } : {}),
      headers: API_HEADERS,
    })
    canonicalNumber = canonical.number
    core.notice(`${canonical.state === 'closed' ? 'Reopened' : 'Updated'} intake eval issue #${canonical.number}.`)
  } else {
    const created = await github.rest.issues.create({
      owner,
      repo,
      title: ISSUE_TITLE,
      body,
      headers: API_HEADERS,
    })
    canonicalNumber = created.data.number
    core.notice(`Created intake eval issue #${canonicalNumber}.`)
  }

  for (const duplicate of openIncidents) {
    if (duplicate.number === canonicalNumber) continue
    await closeDuplicate({ github, owner, repo, duplicate, canonicalNumber })
  }

  return {
    action: canonical ? (canonical.state === 'closed' ? 'reopened' : 'updated') : 'created',
    issueNumber: canonicalNumber,
    failureKind,
  }
}

module.exports = {
  API_HEADERS,
  ISSUE_MARKER,
  ISSUE_TITLE,
  buildFailureBody,
  classifyFailure,
  collectFailures,
  reconcileIntakeEvalIssue,
}
