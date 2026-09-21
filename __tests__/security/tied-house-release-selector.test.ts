import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')
const selectorPath = path.join(
  repoRoot,
  'scripts/security/run-tied-house-release-delta.mjs',
)
const deltaScript = readFileSync(
  path.join(repoRoot, 'scripts/security/check-tied-house-delta.mjs'),
  'utf8',
)

const pr205Marker =
  'supabase/migrations/20260709110000_repair_p0_stored_functions.sql'
const pr204Marker =
  'supabase/migrations/20260709178000_make_canonical_venue_confirmation_effects_replayable.sql'

type ReleaseState = '00' | '10' | '11' | '01'
type SupportedEvent = 'pull_request' | 'push' | 'merge_group'

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
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

function writeFixture(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath)
  mkdirSync(path.dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content)
}

function removeFixture(root: string, relativePath: string) {
  try {
    unlinkSync(path.join(root, relativePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function setReleaseState(root: string, state: ReleaseState) {
  if (state[0] === '1') {
    writeFixture(root, pr205Marker, '-- PR #205 release marker\n')
  } else {
    removeFixture(root, pr205Marker)
  }

  if (state[1] === '1') {
    writeFixture(root, pr204Marker, '-- PR #204 release marker\n')
  } else {
    removeFixture(root, pr204Marker)
  }
}

function commitAll(root: string, message: string) {
  runGit(root, ['add', '--all'])
  runGit(root, ['commit', '-q', '-m', message])
  return runGit(root, ['rev-parse', 'HEAD'])
}

function buildTransition(
  root: string,
  baseState: ReleaseState,
  headState: ReleaseState,
) {
  writeFixture(root, 'README.md', 'release selector fixture\n')
  writeFixture(
    root,
    'scripts/security/check-tied-house-delta.mjs',
    deltaScript,
  )
  writeFixture(root, 'scripts/security/tied-house-pr205-allowlist.json', '[]\n')
  writeFixture(root, 'scripts/security/tied-house-pr204-allowlist.json', '[]\n')
  setReleaseState(root, baseState)
  const base = commitAll(root, `base ${baseState}`)

  setReleaseState(root, headState)
  writeFixture(root, 'ordinary-change.txt', `${baseState} -> ${headState}\n`)
  const head = commitAll(root, `head ${headState}`)
  return { base, head }
}

function eventPayload(eventName: SupportedEvent, base: string, head: string) {
  if (eventName === 'pull_request') {
    return {
      before: head,
      pull_request: {
        base: { sha: base },
        head: { sha: head },
      },
    }
  }
  if (eventName === 'push') {
    return {
      before: base,
      after: head,
      pull_request: { base: { sha: head }, head: { sha: head } },
    }
  }
  return {
    before: head,
    merge_group: { base_sha: base, head_sha: head },
    pull_request: { base: { sha: head }, head: { sha: head } },
  }
}

function runSelector({
  root,
  payloadRoot,
  eventName,
  base,
  head,
  payload = eventPayload(eventName, base, head),
  dryRun = true,
}: {
  root: string
  payloadRoot: string
  eventName: SupportedEvent
  base: string
  head: string
  payload?: unknown
  dryRun?: boolean
}) {
  const eventPath = path.join(payloadRoot, `${eventName}-${Date.now()}.json`)
  writeFileSync(eventPath, JSON.stringify(payload))

  return spawnSync(
    process.execPath,
    [selectorPath, ...(dryRun ? ['--dry-run'] : [])],
    {
      cwd: root,
      env: {
        ...isolatedGitEnvironment(),
        GITHUB_EVENT_NAME: eventName,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: head,
      },
      encoding: 'utf8',
    },
  )
}

describe('tied-house release-stage selector', () => {
  let fixtureRoot: string
  let payloadRoot: string

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), '3rdplace-release-stage-'))
    payloadRoot = mkdtempSync(path.join(tmpdir(), '3rdplace-release-event-'))
    runGit(fixtureRoot, ['init', '-q'])
    runGit(fixtureRoot, ['config', 'user.name', '3rdPlace Test'])
    runGit(fixtureRoot, ['config', 'user.email', 'test@example.com'])
  })

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
    rmSync(payloadRoot, { recursive: true, force: true })
  })

  it.each<SupportedEvent>(['pull_request', 'push', 'merge_group'])(
    'uses the %s event base and selects only the PR #205 allowlist for 00 -> 10',
    (eventName) => {
      const { base, head } = buildTransition(fixtureRoot, '00', '10')
      const result = runSelector({
        root: fixtureRoot,
        payloadRoot,
        eventName,
        base,
        head,
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        `Tied-house release refs: base=${base} head=${head}`,
      )
      expect(result.stdout).toContain('Tied-house release stages: 00 -> 10')
      expect(result.stdout).toContain(
        'Tied-house release allowlist: scripts/security/tied-house-pr205-allowlist.json',
      )
      expect(result.stdout).not.toContain('tied-house-pr204-allowlist.json')
    },
  )

  it('selects only the PR #204 allowlist for post-#205 10 -> 11', () => {
    const { base, head } = buildTransition(fixtureRoot, '10', '11')
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'pull_request',
      base,
      head,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Tied-house release stages: 10 -> 11')
    expect(result.stdout).toContain(
      'Tied-house release allowlist: scripts/security/tied-house-pr204-allowlist.json',
    )
    expect(result.stdout).not.toContain('tied-house-pr205-allowlist.json')
  })

  it('accepts the synthetic pull-request merge commit while validating the PR head', () => {
    const { base, head: pullRequestHead } = buildTransition(
      fixtureRoot,
      '00',
      '10',
    )
    runGit(fixtureRoot, ['checkout', '-q', '-b', 'synthetic-merge', base])
    runGit(fixtureRoot, [
      'merge',
      '--no-ff',
      '-q',
      '-m',
      'synthetic pull-request merge',
      pullRequestHead,
    ])
    const mergeHead = runGit(fixtureRoot, ['rev-parse', 'HEAD'])

    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'pull_request',
      base,
      head: mergeHead,
      payload: {
        pull_request: {
          base: { sha: base },
          head: { sha: pullRequestHead },
        },
      },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      `Tied-house release refs: base=${base} head=${mergeHead}`,
    )
    expect(result.stdout).toContain('Tied-house release stages: 00 -> 10')
    expect(result.stdout).toContain('tied-house-pr205-allowlist.json')
  })

  it('rejects pre-#205 00 -> 11 before the delta command can run', () => {
    const { base, head } = buildTransition(fixtureRoot, '00', '11')
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'pull_request',
      base,
      head,
      dryRun: false,
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Rejected release transition 00 -> 11')
    expect(result.stderr).toContain(
      'PR #204 cannot bypass the required PR #205 base',
    )
    expect(result.stdout).not.toContain('Tied-house delta base:')
  })

  it.each<[ReleaseState, ReleaseState]>([
    ['10', '00'],
    ['11', '10'],
  ])('rejects release-marker removal %s -> %s', (baseState, headState) => {
    const { base, head } = buildTransition(
      fixtureRoot,
      baseState,
      headState,
    )
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'push',
      base,
      head,
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      `Rejected release transition ${baseState} -> ${headState}`,
    )
    expect(result.stderr).toContain('release markers may not be removed')
  })

  it.each<[ReleaseState, ReleaseState, string]>([
    ['01', '01', 'Impossible base release state 01'],
    ['00', '01', 'Impossible head release state 01'],
  ])(
    'rejects impossible marker state %s -> %s',
    (baseState, headState, expectedMessage) => {
      const { base, head } = buildTransition(
        fixtureRoot,
        baseState,
        headState,
      )
      const result = runSelector({
        root: fixtureRoot,
        payloadRoot,
        eventName: 'merge_group',
        base,
        head,
      })

      expect(result.status).toBe(2)
      expect(result.stderr).toContain(expectedMessage)
      expect(result.stderr).toContain(
        'PR #204 marker exists without PR #205 marker',
      )
    },
  )

  it.each<[ReleaseState, ReleaseState]>([
    ['00', '00'],
    ['10', '10'],
    ['11', '11'],
  ])(
    'runs the real delta with no release allowlist for same-stage %s -> %s',
    (baseState, headState) => {
      const { base, head } = buildTransition(fixtureRoot, baseState, headState)
      const result = runSelector({
        root: fixtureRoot,
        payloadRoot,
        eventName: 'push',
        base,
        head,
        dryRun: false,
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        `Tied-house release stages: ${baseState} -> ${headState}`,
      )
      expect(result.stdout).toContain('Tied-house release allowlist: none')
      expect(result.stdout).toContain('Tied-house delta check passed.')
    },
  )

  it('fails closed when push.before is the all-zero SHA', () => {
    const { base, head } = buildTransition(fixtureRoot, '00', '10')
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'push',
      base,
      head,
      payload: { before: '0'.repeat(40), after: head },
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('push.before cannot be the all-zero SHA')
  })

  it('fails closed when merge_group.base_sha is missing', () => {
    const { base, head } = buildTransition(fixtureRoot, '00', '10')
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'merge_group',
      base,
      head,
      payload: { merge_group: { head_sha: head } },
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('merge_group.base_sha is missing')
  })

  it('fails closed when pull_request.base.sha cannot be resolved', () => {
    const { base, head } = buildTransition(fixtureRoot, '00', '10')
    const unresolvable = 'f'.repeat(40)
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'pull_request',
      base,
      head,
      payload: {
        pull_request: {
          base: { sha: unresolvable },
          head: { sha: head },
        },
      },
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain(
      `event base is not a resolvable commit (${unresolvable})`,
    )
  })

  it('fails closed when the selected head is not the checked-out HEAD', () => {
    const { base, head } = buildTransition(fixtureRoot, '00', '10')
    const result = runSelector({
      root: fixtureRoot,
      payloadRoot,
      eventName: 'push',
      base,
      head: base,
      payload: { before: base, after: base },
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('does not match GITHUB_SHA/--head')
  })
})

describe('RLS workflow release-delta wiring', () => {
  const workflow = readFileSync(
    path.join(repoRoot, '.github/workflows/rls-checks.yml'),
    'utf8',
  )

  it('runs the fail-closed wrapper for pull requests, main pushes, and merge groups', () => {
    expect(workflow).toMatch(/\n  pull_request:\n/)
    expect(workflow).toMatch(/\n  push:\n/)
    expect(workflow).toMatch(
      /\n  merge_group:\n    types: \[checks_requested\]\n/,
    )

    const stepStart = workflow.indexOf(
      '      - name: Reject new unreviewed tied-house nomenclature',
    )
    const nextStep = workflow.indexOf('\n      - name:', stepStart + 1)
    const selectorStep = workflow.slice(stepStart, nextStep)

    expect(stepStart).toBeGreaterThan(-1)
    expect(selectorStep).toContain(
      'run: node scripts/security/run-tied-house-release-delta.mjs',
    )
    expect(selectorStep).not.toContain("if: github.event_name == 'pull_request'")
    expect(selectorStep).not.toContain('git cat-file')

    const pushStart = workflow.indexOf('\n  push:\n')
    const pullRequestStart = workflow.indexOf('\n  pull_request:\n')
    const mergeGroupStart = workflow.indexOf('\n  merge_group:\n')
    const pushTrigger = workflow.slice(pushStart, pullRequestStart)
    const pullRequestTrigger = workflow.slice(pullRequestStart, mergeGroupStart)

    for (const target of [
      'app/**',
      'lib/**',
      'components/**',
      'supabase/migrations/**',
      'supabase/seeds/**',
    ]) {
      expect(pushTrigger).toContain(`      - '${target}'`)
      expect(pullRequestTrigger).toContain(`      - '${target}'`)
    }
  })
})
