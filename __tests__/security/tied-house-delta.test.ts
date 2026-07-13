import { spawnSync } from 'child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')
const scriptPath = path.join(
  repoRoot,
  'scripts/security/check-tied-house-delta.mjs',
)

const localGitEnvironmentVariables = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_GRAFT_FILE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
] as const

function isolatedGitEnvironment() {
  const env = { ...process.env }
  for (const variable of localGitEnvironmentVariables) delete env[variable]
  return env
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    env: isolatedGitEnvironment(),
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout)
  }
  return result.stdout.trim()
}

function writeFixture(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function commitBaseline(root: string) {
  runGit(root, ['add', '.'])
  runGit(root, ['commit', '-q', '-m', 'baseline'])
  return runGit(root, ['rev-parse', 'HEAD'])
}

function runGate(root: string, args: string[]) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env: isolatedGitEnvironment(),
    encoding: 'utf8',
  })
}

describe('tied-house strict-delta gate', () => {
  let fixtureRoot: string

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), '3rdplace-tied-house-delta-'))
    runGit(fixtureRoot, ['init', '-q'])
    runGit(fixtureRoot, ['config', 'user.name', '3rdPlace Test'])
    runGit(fixtureRoot, ['config', 'user.email', 'test@example.com'])
    writeFixture(fixtureRoot, 'README.md', 'fixture\n')
  })

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('requires an explicit base ref', () => {
    const result = runGate(fixtureRoot, [])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('--base <git-ref> is required')
  })

  it('ignores line-number and indentation-only moves without touching strict output', () => {
    writeFixture(
      fixtureRoot,
      'app/legacy.ts',
      "export const legacy = 'kickback'\n",
    )
    writeFixture(
      fixtureRoot,
      'qa-artifacts/tied-house-violations.txt',
      'tracked sentinel\n',
    )
    const base = commitBaseline(fixtureRoot)

    writeFixture(
      fixtureRoot,
      'app/legacy.ts',
      "\n\n  export const legacy = 'kickback'\n",
    )
    const result = runGate(fixtureRoot, ['--base', base])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Strict findings: base=1 current=1 inherited=1 removed=0 new=0',
    )
    expect(result.stdout).toContain('Inherited strict findings remain: 1')
    expect(
      readFileSync(
        path.join(
          fixtureRoot,
          'qa-artifacts/tied-house-violations.txt',
        ),
        'utf8',
      ),
    ).toBe('tracked sentinel\n')
  })

  it('allows one explicitly reviewed occurrence and reports it', () => {
    const base = commitBaseline(fixtureRoot)
    const migration =
      'supabase/migrations/20260709100000_add_write_pause_control.sql'
    writeFixture(fixtureRoot, migration, "  'kickback_payments',\n")

    const result = runGate(fixtureRoot, [
      '--base',
      base,
      '--allow',
      `${migration}::'kickback_payments',`,
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('allowed=1 unlisted=0 unused_allowances=0')
    expect(result.stdout).toContain(
      `ALLOWED ${migration}:1: 'kickback_payments',`,
    )
  })

  it('loads a multi-entry reviewed allowlist and reports every allowed finding', () => {
    const base = commitBaseline(fixtureRoot)
    const migration =
      'supabase/migrations/20260709110000_repair_p0_stored_functions.sql'
    writeFixture(
      fixtureRoot,
      migration,
      "  source_table := 'kickback_payments';\n  source_key := 'event_kickback_agreements';\n",
    )
    writeFixture(
      fixtureRoot,
      'reviewed-allowlist.json',
      JSON.stringify([
        {
          path: migration,
          text: "source_table := 'kickback_payments';",
          count: 1,
        },
        {
          path: migration,
          text: "source_key := 'event_kickback_agreements';",
          count: 1,
        },
      ]),
    )

    const result = runGate(fixtureRoot, [
      '--base',
      base,
      '--allowlist',
      'reviewed-allowlist.json',
    ])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('allowed=2 unlisted=0 unused_allowances=0')
    expect(result.stdout.match(/^ALLOWED /gm)).toHaveLength(2)
    expect(result.stdout).toContain(
      `ALLOWED ${migration}:1: source_table := 'kickback_payments';`,
    )
    expect(result.stdout).toContain(
      `ALLOWED ${migration}:2: source_key := 'event_kickback_agreements';`,
    )
  })

  it('fails an unlisted addition while still reporting reviewed additions', () => {
    const base = commitBaseline(fixtureRoot)
    const migration =
      'supabase/migrations/20260709100000_add_write_pause_control.sql'
    writeFixture(fixtureRoot, migration, "  'kickback_payments',\n")
    writeFixture(
      fixtureRoot,
      'app/api/example/route.ts',
      "throw new Error('new kickback failure')\n",
    )

    const result = runGate(fixtureRoot, [
      '--base',
      base,
      '--allow',
      `${migration}::'kickback_payments',`,
    ])

    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      `ALLOWED ${migration}:1: 'kickback_payments',`,
    )
    expect(result.stderr).toContain(
      "UNLISTED app/api/example/route.ts:1: throw new Error('new kickback failure')",
    )
  })

  it('fails excess occurrences beyond the reviewed count', () => {
    const base = commitBaseline(fixtureRoot)
    const migration =
      'supabase/migrations/20260709100000_add_write_pause_control.sql'
    writeFixture(
      fixtureRoot,
      migration,
      "  'kickback_payments',\n  'kickback_payments',\n",
    )

    const result = runGate(fixtureRoot, [
      '--base',
      base,
      '--allow',
      `${migration}::'kickback_payments',`,
    ])

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('allowed=1 unlisted=1 unused_allowances=0')
    expect(result.stderr).toContain(
      `UNLISTED ${migration}:2: 'kickback_payments',`,
    )
  })

  it('fails stale allowances so future reintroduction cannot be hidden', () => {
    const base = commitBaseline(fixtureRoot)
    const result = runGate(fixtureRoot, [
      '--base',
      base,
      '--allow',
      "app/removed.ts::export const term = 'kickback'",
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "UNUSED app/removed.ts::export const term = 'kickback' (1 occurrence)",
    )
  })
})
