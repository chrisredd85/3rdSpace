import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../..')
const setupScript = path.join(repoRoot, 'scripts/release/rehearse-bundle-setup.sh')
const rehearsalScript = path.join(repoRoot, 'scripts/release/rehearse-bundle.sh')
const reportTemplate = path.join(repoRoot, 'scripts/release/rehearsal-report-template.md')
const releaseRunbook = path.join(repoRoot, 'docs/runbooks/20260710-prompts-1-8-release.md')
const hostedAclVerifier = path.join(repoRoot, 'scripts/security/verify-hosted-acls.sql')
const rlsWorkflow = path.join(repoRoot, '.github/workflows/rls-checks.yml')
const tiedHouseReleaseSelector = path.join(
  repoRoot,
  'scripts/security/run-tied-house-release-delta.mjs',
)
const pr204TiedHouseAllowlist = path.join(repoRoot, 'scripts/security/tied-house-pr204-allowlist.json')
const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()

const safeEnvironment = {
  ...process.env,
  REHEARSAL_DATABASE_URL: 'postgresql://clone_user:secret-value@clone-db.example.invalid:5432/postgres',
  REHEARSAL_CLONE_ID: 'clone-test-001',
  REHEARSAL_EXPECTED_BASELINE_VERSION: '20260709110000',
  REHEARSAL_OLD_PRODUCTION_SHA: '461e3da4e569a41d27c6e972fc467ef3ba042d17',
  REHEARSAL_TARGET_CLASS: 'clone',
  PRODUCTION_PROJECT_REF: 'production-project-ref-123',
}

const temporaryDirectories: string[] = []

function temporaryDirectory(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function run(script: string, args: string[], env = safeEnvironment) {
  const fakeGitBin = temporaryDirectory('rehearsal-clean-git-')
  const fakeGit = path.join(fakeGitBin, 'git')
  fs.writeFileSync(fakeGit, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"diff --quiet HEAD -- supabase/migrations"* ]]; then
  exit 0
fi
if [[ "$*" == *"ls-files --others --exclude-standard -- supabase/migrations"* ]]; then
  exit 0
fi
exec "$REAL_GIT" "$@"
`)
  fs.chmodSync(fakeGit, 0o755)

  return spawnSync('bash', [script, ...args], {
    cwd: repoRoot,
    env: {
      ...env,
      PATH: `${fakeGitBin}:${env.PATH}`,
      REAL_GIT: realGit,
    },
    encoding: 'utf8',
  })
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true })
  }
})

describe('Prompt 1-8 clone rehearsal scripts', () => {
  it('pins the exact reviewed 22-migration inventory and all required gates', () => {
    const setup = fs.readFileSync(setupScript, 'utf8')
    const runner = fs.readFileSync(rehearsalScript, 'utf8')
    const template = fs.readFileSync(reportTemplate, 'utf8')
    const runbook = fs.readFileSync(releaseRunbook, 'utf8')
    const aclVerifier = fs.readFileSync(hostedAclVerifier, 'utf8')
    const workflow = fs.readFileSync(rlsWorkflow, 'utf8')
    const tiedHouseAllowlist = JSON.parse(
      fs.readFileSync(pr204TiedHouseAllowlist, 'utf8'),
    ) as Array<{ count: number }>
    const manifestBlock = setup.match(/BUNDLE_MIGRATIONS=\(([\s\S]*?)\n\)/)?.[1] ?? ''
    const migrations = Array.from(manifestBlock.matchAll(/"([0-9]{14}_[a-z0-9_]+\.sql)"/g), (match) => match[1])

    expect(migrations).toHaveLength(22)
    expect(migrations[0]).toBe('20260709114000_atomic_vendor_base_rate_repair.sql')
    expect(migrations[11]).toBe('20260709166000_harden_canonical_booking_provenance.sql')
    expect(migrations[21]).toBe('20260709178000_make_canonical_venue_confirmation_effects_replayable.sql')
    expect(runner).toContain('preflight-server-owned-execution.sql')
    expect(runner).toContain('verify-plan-supply-intents.sql')
    expect(runner).toContain('verify-hosted-acls.sql')
    expect(runner).toContain('verify-hosted-control-plane.sql')
    expect(setup).toContain('REHEARSAL_OLD_PRODUCTION_SHA')
    expect(setup).toContain('merge-base --is-ancestor')
    expect(setup).toContain('20260701090000')
    expect(setup).toContain('20260709090000')
    expect(setup).toContain('20260709100000')
    expect(template).toContain('Old-production-code compatibility against the new schema')
    expect(template).toContain('REHEARSAL_OLD_PRODUCTION_SHA')
    expect(template).toContain('deliberate-failure-proof.txt')
    expect(template).toContain('Total migration apply duration')
    expect(runner).toContain('rehearsal_injected_failure_at_')
    expect(runner).toContain('old-production-source-inventory.tsv')
    expect(runner).toContain('/api/planner/plans/[planId]/recommend')
    expect(runbook.match(/REHEARSAL_TARGET_CLASS='clone'/g)).toHaveLength(2)

    const serviceOnlyBlock = aclVerifier.match(/v_service_only constant regprocedure\[\] := ARRAY\[([\s\S]*?)\n  \];/)?.[1] ?? ''
    const authenticatedBlock = aclVerifier.match(/v_authenticated constant regprocedure\[\] := ARRAY\[([\s\S]*?)\n  \];/)?.[1] ?? ''
    expect(serviceOnlyBlock.match(/::regprocedure/g)).toHaveLength(41)
    expect(authenticatedBlock.match(/::regprocedure/g)).toHaveLength(11)
    expect(aclVerifier).toContain('52-function allowlist')
    expect(aclVerifier).toContain('41 service-only, 11 authenticated-scoped')
    expect(tiedHouseAllowlist.reduce((total, entry) => total + entry.count, 0)).toBe(12)
    expect(workflow).toContain(
      'run: node scripts/security/run-tied-house-release-delta.mjs',
    )
    expect(fs.existsSync(tiedHouseReleaseSelector)).toBe(true)
  })

  it('plans setup and the complete ordered bundle without connecting or leaking the URL', () => {
    const setupArtifacts = temporaryDirectory('rehearsal-setup-dry-')
    const setupResult = run(setupScript, [
      '--confirm-non-production',
      '--dry-run',
      '--artifacts-dir', setupArtifacts,
    ])

    expect(setupResult.status).toBe(0)
    expect(setupResult.stdout).toContain('no database connection or mutation was attempted')
    expect(setupResult.stdout).not.toContain('secret-value')
    expect(fs.readFileSync(path.join(setupArtifacts, 'migration-manifest.tsv'), 'utf8').trim().split('\n')).toHaveLength(23)
    expect(fs.readFileSync(path.join(setupArtifacts, 'setup-receipt.txt'), 'utf8')).not.toContain('secret-value')

    const bundleArtifacts = temporaryDirectory('rehearsal-bundle-dry-')
    const bundleResult = run(rehearsalScript, [
      '--confirm-non-production',
      '--dry-run',
      '--fail-at', '12',
      '--run-id', 'dry-run-test',
      '--artifacts-dir', bundleArtifacts,
    ])

    expect(bundleResult.status).toBe(0)
    expect(bundleResult.stdout.match(/^\d{2} 202607091\d{5}_.+\.sql$/gm)).toHaveLength(22)
    expect(bundleResult.stdout).toContain('12 20260709166000_harden_canonical_booking_provenance.sql')
    expect(bundleResult.stdout).toContain('run migration 12 inside one transaction')
    expect(bundleResult.stdout).toContain('prove rollback to 20260709165000')
    expect(bundleResult.stdout).toContain('verify-hosted-control-plane.sql')
    expect(bundleResult.stdout).not.toContain('secret-value')
    expect(fs.readFileSync(path.join(bundleArtifacts, 'old-production-source-inventory.tsv'), 'utf8'))
      .toContain('461e3da4e569a41d27c6e972fc467ef3ba042d17')
  })

  it('refuses declared production identities before any database call', () => {
    const artifacts = temporaryDirectory('rehearsal-production-refusal-')
    const result = run(setupScript, [
      '--confirm-non-production',
      '--dry-run',
      '--database-url', 'postgresql://user:secret-value@production-project-ref-123.db.example.com:5432/postgres',
      '--artifacts-dir', artifacts,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contains the declared production project ref')
    expect(fs.existsSync(path.join(artifacts, 'setup-receipt.txt'))).toBe(false)
  })

  it('refuses a production target class even in dry-run mode', () => {
    const artifacts = temporaryDirectory('rehearsal-production-class-')
    const result = run(setupScript, [
      '--confirm-non-production',
      '--dry-run',
      '--target-class', 'production',
      '--artifacts-dir', artifacts,
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("target class must be exactly 'clone'")
  })

  it('requires the production project ref even when an optional production URL is supplied', () => {
    const artifacts = temporaryDirectory('rehearsal-missing-production-ref-')
    const withoutProductionRef: NodeJS.ProcessEnv = {
      ...safeEnvironment,
      PRODUCTION_DATABASE_URL: 'postgresql://prod:secret-value@prod-db.example.invalid:5432/postgres',
    }
    delete withoutProductionRef.PRODUCTION_PROJECT_REF

    const result = run(setupScript, [
      '--confirm-non-production',
      '--dry-run',
      '--artifacts-dir', artifacts,
    ], withoutProductionRef)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('PRODUCTION_PROJECT_REF is required')
  })

  it('requires a frozen full old-production REVIEWED_BASE_SHA', () => {
    const artifacts = temporaryDirectory('rehearsal-missing-reviewed-base-')
    const withoutReviewedBase: NodeJS.ProcessEnv = { ...safeEnvironment }
    delete withoutReviewedBase.REHEARSAL_OLD_PRODUCTION_SHA
    const result = run(setupScript, [
      '--confirm-non-production',
      '--dry-run',
      '--artifacts-dir', artifacts,
    ], withoutReviewedBase)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must be the full 40-character REVIEWED_BASE_SHA')
  })

  it('refuses a clone guard that does not identify its source snapshot', () => {
    const fakeBin = temporaryDirectory('rehearsal-missing-snapshot-bin-')
    const artifacts = temporaryDirectory('rehearsal-missing-snapshot-')
    const fakePsql = path.join(fakeBin, 'psql')
    fs.writeFileSync(fakePsql, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"environment_guard"* ]]; then
  echo "clone|true|clone-test-001|"
else
  exit 99
fi
`)
    fs.chmodSync(fakePsql, 0o755)

    const result = run(setupScript, [
      '--confirm-non-production',
      '--artifacts-dir', artifacts,
    ], {
      ...safeEnvironment,
      PATH: `${fakeBin}:${process.env.PATH}`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must record a non-empty source_snapshot')
    expect(fs.existsSync(path.join(artifacts, 'setup-receipt.txt'))).toBe(false)
  })

  it('refuses a 20260709110000 baseline when the PR 203 prerequisite ledger row is missing', () => {
    const fakeBin = temporaryDirectory('rehearsal-missing-prerequisite-bin-')
    const artifacts = temporaryDirectory('rehearsal-missing-prerequisite-')
    const fakePsql = path.join(fakeBin, 'psql')
    fs.writeFileSync(fakePsql, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"environment_guard"* ]]; then
  echo "clone|true|clone-test-001|snapshot-missing-pr-203"
elif [[ "$args" == *"max(version)"* ]]; then
  echo "20260709110000"
elif [[ "$args" == *"20260701090000"* && "$args" == *"20260709090000"* && "$args" == *"20260709100000"* && "$args" == *"20260709110000"* ]]; then
  echo "20260701090000,20260709100000,20260709110000"
else
  exit 99
fi
`)
    fs.chmodSync(fakePsql, 0o755)

    const result = run(setupScript, [
      '--confirm-non-production',
      '--artifacts-dir', artifacts,
    ], {
      ...safeEnvironment,
      PATH: `${fakeBin}:${process.env.PATH}`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('clone prerequisite ledger mismatch')
    expect(result.stderr).toContain('20260709090000')
    expect(fs.existsSync(path.join(artifacts, 'setup-receipt.txt'))).toBe(false)
  })

  it('injects a failure inside migration N and proves its transaction rolls back to N-1', () => {
    const fakeBin = temporaryDirectory('rehearsal-fake-bin-')
    const artifacts = temporaryDirectory('rehearsal-deliberate-failure-')
    const ledgerState = path.join(fakeBin, 'ledger-state')
    const invocationLog = path.join(fakeBin, 'invocations')
    const fakePsql = path.join(fakeBin, 'psql')
    fs.writeFileSync(ledgerState, '20260701090000\n20260709090000\n20260709100000\n20260709110000\n')
    fs.writeFileSync(invocationLog, '')
    fs.writeFileSync(fakePsql, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >>"$FAKE_INVOCATION_LOG"
if [[ "$args" == *"environment_guard"* ]]; then
  echo "clone|true|clone-test-001|snapshot-test-001"
elif [[ "$args" == *"current_database()"* ]]; then
  echo "clone_db@127.0.0.1:5432"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260701090000"* && "$args" == *"20260709090000"* && "$args" == *"20260709100000"* && "$args" == *"20260709110000"* ]]; then
  echo "20260701090000,20260709090000,20260709100000,20260709110000"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260709114000"* ]]; then
  grep '^202607091[1-9]' "$FAKE_LEDGER_STATE" | grep -v '^20260709110000$' | paste -sd, - || true
elif [[ "$args" == *"max(version)"* ]]; then
  tail -n 1 "$FAKE_LEDGER_STATE"
elif [[ "$args" == *"rehearsal_injected_failure_at_"* ]]; then
  [[ "$args" == *"--single-transaction"* ]]
  echo "ERROR: rehearsal_injected_failure_at_20260709115000" >&2
  exit 17
elif [[ "$args" == *"INSERT INTO supabase_migrations.schema_migrations"* ]]; then
  version="$(printf '%s' "$args" | sed -n "s/.*VALUES ('\\([0-9]\\{14\\}\\)'.*/\\1/p")"
  [[ -n "$version" ]]
  printf '%s\\n' "$version" >>"$FAKE_LEDGER_STATE"
else
  exit 0
fi
`)
    fs.chmodSync(fakePsql, 0o755)

    const result = run(rehearsalScript, [
      '--confirm-non-production',
      '--fail-at', '2',
      '--run-id', 'failure-proof-test',
      '--artifacts-dir', artifacts,
    ], {
      ...safeEnvironment,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_LEDGER_STATE: ledgerState,
      FAKE_INVOCATION_LOG: invocationLog,
    })

    expect(result.status).toBe(42)
    expect(fs.readFileSync(ledgerState, 'utf8').trim().split('\n').pop()).toBe('20260709114000')
    expect(fs.readFileSync(path.join(artifacts, 'last-committed-version.txt'), 'utf8').trim()).toBe('20260709114000')
    const failureProof = fs.readFileSync(path.join(artifacts, 'deliberate-failure-proof.txt'), 'utf8')
    expect(failureProof).toContain('injected_failure=rehearsal_injected_failure_at_20260709115000')
    expect(failureProof).toContain('transaction_rollback=PASS')
    expect(failureProof).toContain('proof=PASS')
    expect(fs.readFileSync(invocationLog, 'utf8')).toContain('rehearsal_injected_failure_at_20260709115000')
    expect(fs.readFileSync(invocationLog, 'utf8')).toContain('--single-transaction')
    expect(fs.readFileSync(path.join(artifacts, 'migration-timings.tsv'), 'utf8')).toContain('deliberate_failure_rolled_back')
  })

  it('does not mistake a migration failure before the sentinel for a successful failure drill', () => {
    const fakeBin = temporaryDirectory('rehearsal-pre-sentinel-failure-bin-')
    const artifacts = temporaryDirectory('rehearsal-pre-sentinel-failure-')
    const ledgerState = path.join(fakeBin, 'ledger-state')
    const fakePsql = path.join(fakeBin, 'psql')
    fs.writeFileSync(ledgerState, '20260701090000\n20260709090000\n20260709100000\n20260709110000\n')
    fs.writeFileSync(fakePsql, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
if [[ "$args" == *"environment_guard"* ]]; then
  echo "clone|true|clone-test-001|snapshot-pre-sentinel-failure"
elif [[ "$args" == *"current_database()"* ]]; then
  echo "clone_db@127.0.0.1:5432"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260701090000"* && "$args" == *"20260709090000"* && "$args" == *"20260709100000"* && "$args" == *"20260709110000"* ]]; then
  echo "20260701090000,20260709090000,20260709100000,20260709110000"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260709114000"* ]]; then
  grep '^202607091[1-9]' "$FAKE_LEDGER_STATE" | grep -v '^20260709110000$' | paste -sd, - || true
elif [[ "$args" == *"max(version)"* ]]; then
  tail -n 1 "$FAKE_LEDGER_STATE"
elif [[ "$args" == *"rehearsal_injected_failure_at_"* ]]; then
  echo "ERROR: migration body failed before deliberate sentinel" >&2
  exit 17
elif [[ "$args" == *"INSERT INTO supabase_migrations.schema_migrations"* ]]; then
  version="$(printf '%s' "$args" | sed -n "s/.*VALUES ('\\([0-9]\\{14\\}\\)'.*/\\1/p")"
  [[ -n "$version" ]]
  printf '%s\\n' "$version" >>"$FAKE_LEDGER_STATE"
else
  exit 0
fi
`)
    fs.chmodSync(fakePsql, 0o755)

    const result = run(rehearsalScript, [
      '--confirm-non-production',
      '--fail-at', '1',
      '--run-id', 'pre-sentinel-failure-test',
      '--artifacts-dir', artifacts,
    ], {
      ...safeEnvironment,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_LEDGER_STATE: ledgerState,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('failed before the deliberate failure sentinel executed')
    expect(result.stderr).not.toContain('Deliberate failure verified')
    expect(fs.readFileSync(ledgerState, 'utf8').trim().split('\n').pop()).toBe('20260709110000')
    const failureProof = fs.readFileSync(path.join(artifacts, 'deliberate-failure-proof.txt'), 'utf8')
    expect(failureProof).toContain('injected_failure_observed=false')
    expect(failureProof).toContain('proof=FAILED')
    expect(fs.readFileSync(path.join(artifacts, 'migration-timings.tsv'), 'utf8'))
      .toContain('migration_failed_before_deliberate_injection')
  })

  it('runs the complete 22-step rehearsal control flow and all post-apply gates', () => {
    const fakeBin = temporaryDirectory('rehearsal-full-fake-bin-')
    const artifacts = temporaryDirectory('rehearsal-full-flow-')
    const ledgerState = path.join(fakeBin, 'ledger-state')
    const invocationLog = path.join(fakeBin, 'invocations')
    const fakePsql = path.join(fakeBin, 'psql')
    fs.writeFileSync(ledgerState, '20260701090000\n20260709090000\n20260709100000\n20260709110000\n')
    fs.writeFileSync(invocationLog, '')
    fs.writeFileSync(fakePsql, `#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '%s\\n' "$args" >>"$FAKE_INVOCATION_LOG"
if [[ "$args" == *"environment_guard"* ]]; then
  echo "clone|true|clone-test-001|snapshot-test-full"
elif [[ "$args" == *"current_database()"* ]]; then
  echo "clone_db@127.0.0.1:5432"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260701090000"* && "$args" == *"20260709090000"* && "$args" == *"20260709100000"* && "$args" == *"20260709110000"* ]]; then
  echo "20260701090000,20260709090000,20260709100000,20260709110000"
elif [[ "$args" == *"string_agg(version"* && "$args" == *"20260709114000"* ]]; then
  grep '^202607091[1-9]' "$FAKE_LEDGER_STATE" | grep -v '^20260709110000$' | paste -sd, - || true
elif [[ "$args" == *"max(version)"* ]]; then
  tail -n 1 "$FAKE_LEDGER_STATE"
elif [[ "$args" == *"INSERT INTO supabase_migrations.schema_migrations"* ]]; then
  version="$(printf '%s' "$args" | sed -n "s/.*VALUES ('\\([0-9]\\{14\\}\\)'.*/\\1/p")"
  [[ -n "$version" ]]
  printf '%s\\n' "$version" >>"$FAKE_LEDGER_STATE"
elif [[ "$args" == *"WITH probes(method, route"* ]]; then
  printf 'method\\troute\\trole_name\\tobject_kind\\tobject_name\\tprivilege_name\\tstatus\\timpact\\n'
  printf 'POST\\t/api/planner/plans\\tauthenticated\\ttable\\tpublic.plan_messages\\tINSERT\\tbreaks\\told route breaks\\n'
  printf 'POST\\t/api/payments/capture\\tservice_role\\ttable\\tpublic.payment_intents\\tUPDATE\\tcompatible\\tservice path works\\n'
else
  exit 0
fi
`)
    fs.chmodSync(fakePsql, 0o755)

    const result = run(rehearsalScript, [
      '--confirm-non-production',
      '--run-id', 'full-flow-test',
      '--artifacts-dir', artifacts,
    ], {
      ...safeEnvironment,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_LEDGER_STATE: ledgerState,
      FAKE_INVOCATION_LOG: invocationLog,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Last committed version: 20260709178000')
    expect(fs.readFileSync(ledgerState, 'utf8').trim().split('\n')).toHaveLength(26)
    expect(fs.readFileSync(path.join(artifacts, 'migration-timings.tsv'), 'utf8').trim().split('\n')).toHaveLength(23)
    expect(fs.readFileSync(path.join(artifacts, 'last-committed-version.txt'), 'utf8').trim()).toBe('20260709178000')
    const report = fs.readFileSync(path.join(artifacts, 'rehearsal-report.md'), 'utf8')
    expect(report).toContain('Status: `passed`')
    expect(report).toMatch(/Total migration apply duration \(ms\): `\d+`/)
    expect(fs.readFileSync(path.join(artifacts, 'old-production-route-breakage-list.md'), 'utf8')).toContain('POST /api/planner/plans')
    expect(fs.readFileSync(path.join(artifacts, 'old-production-route-probe-manifest.tsv'), 'utf8'))
      .toContain('/api/planner/plans/[planId]/recommend')
    expect(fs.readFileSync(path.join(artifacts, 'old-production-source-inventory.tsv'), 'utf8'))
      .toContain('lib/outreach/gmailApprovalFlow.ts')

    const invocations = fs.readFileSync(invocationLog, 'utf8')
    expect(invocations.match(/preflight-server-owned-execution\.sql/g)).toHaveLength(2)
    expect(invocations).toContain('verify-plan-supply-intents.sql')
    expect(invocations).toContain('verify-hosted-acls.sql')
    expect(invocations).toContain('verify-hosted-control-plane.sql')
  })
})
