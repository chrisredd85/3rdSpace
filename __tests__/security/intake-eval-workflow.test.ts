/**
 * @jest-environment node
 */
import { readFileSync } from 'fs'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'eval-intake-nightly.yml'),
  'utf8',
)
const issueReconciler = readFileSync(
  path.join(repoRoot, '.github', 'scripts', 'reconcile-intake-eval-issue.cjs'),
  'utf8',
)
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

function jobBlock(name: string) {
  const lines = workflow.split('\n')
  const start = lines.findIndex((line) => line === `  ${name}:`)
  if (start === -1) throw new Error(`Missing ${name} job`)

  const end = lines.findIndex(
    (line, index) => index > start && /^  [a-z][a-z0-9-]+:$/.test(line),
  )
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

describe('intake eval workflow safety', () => {
  it('uses least privilege and isolates issue writes from the paid eval job', () => {
    const evalJob = jobBlock('eval-intake')
    const issueJob = jobBlock('reconcile-intake-issue')

    expect(workflow).toContain('permissions: {}')
    expect(evalJob).toContain('      actions: read')
    expect(evalJob).toContain('      contents: read')
    expect(evalJob).not.toContain('issues: write')
    expect(issueJob).toContain('      contents: read')
    expect(issueJob).toContain('      issues: write')
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2)
  })

  it('fails fast with a dedicated eval secret before installing dependencies', () => {
    const preflightIndex = workflow.indexOf('- name: Validate eval configuration')
    const installIndex = workflow.indexOf('- name: Install dependencies')

    expect(preflightIndex).toBeGreaterThan(-1)
    expect(preflightIndex).toBeLessThan(installIndex)
    expect(workflow).toContain('OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY_EVAL }}')
    expect(workflow).toContain('::error title=Missing OPENAI_API_KEY_EVAL::')
    expect(workflow).not.toContain('secrets.OPENAI_API_KEY }}')
  })

  it('restores rolling history and treats a broken restore as a workflow failure', () => {
    const restoreIndex = workflow.indexOf('- name: Restore prior intake eval history')
    const evalIndex = workflow.indexOf('- name: Run intake phrase eval')

    expect(restoreIndex).toBeGreaterThan(-1)
    expect(restoreIndex).toBeLessThan(evalIndex)
    expect(workflow).toContain("-H 'X-GitHub-Api-Version: 2026-03-10'")
    expect(workflow).toContain('            --paginate')
    expect(workflow).toContain('            --slurp')
    expect(workflow).toContain('.workflow_run.head_branch == $branch')
    expect(workflow).toContain('/actions/artifacts/${previous_artifact_id}/zip')
    expect(workflow).toContain('unzip -qq "$artifact_archive" -d evals/intake/history')
    expect(workflow).toContain("always() && steps.history.outcome == 'failure'")
  })

  it('uploads a real report after failures without accepting an empty artifact', () => {
    expect(workflow).toContain("!cancelled() && steps.eval.outcome != 'skipped'")
    expect(workflow).toContain("steps.eval.outputs.result == 'threshold_failure'")
    expect(workflow).toContain('intake-phrase-eval-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}')
    expect(workflow.match(/if-no-files-found: error/g)).toHaveLength(2)
    expect(workflow.match(/retention-days: 30/g)).toHaveLength(2)
    expect(workflow).toContain('          overwrite: true')
    expect(workflow).toContain('run-metadata.json')
    expect(workflow).toContain('eval.log')
    expect(workflow).not.toContain('if-no-files-found: warn')
  })

  it('emits an explicit current-run result instead of inferring it from restored history', () => {
    expect(workflow).toContain("result='execution_error'")
    expect(workflow).toContain("result='threshold_failure'")
    expect(workflow).toContain("result='report_missing'")
    expect(workflow).toContain('eval_result: ${{ steps.eval.outputs.result }}')
    expect(workflow).toContain('EVAL_RESULT: ${{ needs.eval-intake.outputs.eval_result }}')
    expect(workflow).toContain('comm -13 "$before_reports" "$after_reports"')
  })

  it('reconciles one default-branch issue in a separate always-running job', () => {
    const issueJob = jobBlock('reconcile-intake-issue')

    expect(issueJob).toContain('needs: eval-intake')
    expect(issueJob).toContain('always() && !cancelled()')
    expect(issueJob).toContain('github.ref_name == github.event.repository.default_branch')
    expect(issueJob).toContain('uses: actions/github-script@v9')
    expect(issueJob).toContain('reconcile-intake-eval-issue.cjs')
    expect(issueReconciler).toContain("'X-GitHub-Api-Version': '2026-03-10'")
    expect(issueReconciler).toContain("state_reason: 'reopened'")
    expect(issueReconciler).toContain("state_reason: 'completed'")
  })

  it('uses a pinned local TypeScript runner instead of downloading one at runtime', () => {
    expect(packageJson.devDependencies.tsx).toBe('^4.23.12')
    expect(packageJson.scripts['eval:intake:ci']).toContain('tsx ')
    expect(packageJson.scripts['eval:intake:ci']).not.toContain('npx tsx')
  })
})
