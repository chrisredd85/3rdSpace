#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MAX_BUFFER = 256 * 1024 * 1024
const ZERO_SHA_PATTERN = /^0+$/
const SUPPORTED_EVENTS = new Set(['pull_request', 'push', 'merge_group'])

const RELEASE_MARKERS = {
  pr205:
    'supabase/migrations/20260709110000_repair_p0_stored_functions.sql',
  pr204:
    'supabase/migrations/20260709178000_make_canonical_venue_confirmation_effects_replayable.sql',
}

const RELEASE_ALLOWLISTS = {
  pr205: 'scripts/security/tied-house-pr205-allowlist.json',
  pr204: 'scripts/security/tied-house-pr204-allowlist.json',
}

function usage() {
  return [
    'Usage: node scripts/security/run-tied-house-release-delta.mjs [options]',
    '',
    'Options:',
    '  --event-name <pull_request|push|merge_group>',
    '  --event-path <GitHub webhook payload JSON>',
    '  --head <checked-out git ref>',
    '  --dry-run  Validate refs and print the selected release allowance only',
    '',
    'Defaults: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, and GITHUB_SHA.',
  ].join('\n')
}

function parseArguments(argv) {
  const parsed = {
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    eventPath: process.env.GITHUB_EVENT_PATH ?? '',
    headRef: process.env.GITHUB_SHA ?? '',
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      return { ...parsed, help: true }
    }
    if (argument === '--dry-run') {
      parsed.dryRun = true
      continue
    }

    const optionNames = new Map([
      ['--event-name', 'eventName'],
      ['--event-path', 'eventPath'],
      ['--head', 'headRef'],
    ])
    const field = optionNames.get(argument)
    if (field) {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} requires a value`)
      parsed[field] = value
      index += 1
      continue
    }

    const equalsOption = [...optionNames].find(([name]) =>
      argument.startsWith(`${name}=`),
    )
    if (equalsOption) {
      const [name, equalsField] = equalsOption
      const value = argument.slice(name.length + 1)
      if (!value) throw new Error(`${name} requires a value`)
      parsed[equalsField] = value
      continue
    }

    throw new Error(`Unknown argument: ${argument}`)
  }

  return { ...parsed, help: false }
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })

  if (result.error) throw result.error
  if (result.status === 0) return result.stdout.trim()

  throw new Error(
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
  )
}

function resolveRepositoryRoot(cwd) {
  return runGit(cwd, ['rev-parse', '--show-toplevel'])
}

function requireNonZeroRef(value, source) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${source} is missing`)
  }
  const normalized = value.trim()
  if (ZERO_SHA_PATTERN.test(normalized)) {
    throw new Error(`${source} cannot be the all-zero SHA`)
  }
  return normalized
}

function readPayload(eventPath) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH/--event-path is required')
  try {
    const payload = JSON.parse(readFileSync(eventPath, 'utf8'))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be a JSON object')
    }
    return payload
  } catch (error) {
    throw new Error(`Could not read GitHub event payload ${eventPath}: ${error.message}`)
  }
}

function eventRefs(eventName, payload) {
  if (!SUPPORTED_EVENTS.has(eventName)) {
    throw new Error(`Unsupported GitHub event: ${eventName || '(missing)'}`)
  }

  if (eventName === 'pull_request') {
    return {
      baseRef: requireNonZeroRef(
        payload.pull_request?.base?.sha,
        'pull_request.base.sha',
      ),
      eventHeadRef: requireNonZeroRef(
        payload.pull_request?.head?.sha,
        'pull_request.head.sha',
      ),
      checkedHeadMayBeMergeCommit: true,
    }
  }

  if (eventName === 'push') {
    return {
      baseRef: requireNonZeroRef(payload.before, 'push.before'),
      eventHeadRef: requireNonZeroRef(payload.after, 'push.after'),
      checkedHeadMayBeMergeCommit: false,
    }
  }

  return {
    baseRef: requireNonZeroRef(
      payload.merge_group?.base_sha,
      'merge_group.base_sha',
    ),
    eventHeadRef: requireNonZeroRef(
      payload.merge_group?.head_sha,
      'merge_group.head_sha',
    ),
    checkedHeadMayBeMergeCommit: false,
  }
}

function resolveCommit(repoRoot, ref, source) {
  try {
    return runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])
  } catch (error) {
    throw new Error(`${source} is not a resolvable commit (${ref}): ${error.message}`)
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: MAX_BUFFER },
  )
  if (result.error) throw result.error
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(
    `git merge-base --is-ancestor failed: ${(result.stderr || result.stdout || '').trim()}`,
  )
}

function markerExists(repoRoot, commit, markerPath) {
  const match = runGit(repoRoot, [
    'ls-tree',
    '--full-tree',
    '--name-only',
    commit,
    '--',
    markerPath,
  ])
  return match === markerPath
}

function releaseState(repoRoot, commit) {
  const hasPr205 = markerExists(repoRoot, commit, RELEASE_MARKERS.pr205)
  const hasPr204 = markerExists(repoRoot, commit, RELEASE_MARKERS.pr204)
  return `${hasPr205 ? '1' : '0'}${hasPr204 ? '1' : '0'}`
}

function selectAllowlist(baseState, headState) {
  for (const [label, state] of [
    ['base', baseState],
    ['head', headState],
  ]) {
    if (state === '01') {
      throw new Error(
        `Impossible ${label} release state 01: PR #204 marker exists without PR #205 marker`,
      )
    }
    if (!['00', '10', '11'].includes(state)) {
      throw new Error(`Unknown ${label} release state: ${state}`)
    }
  }

  if (baseState === headState) return null
  if (baseState === '00' && headState === '10') return RELEASE_ALLOWLISTS.pr205
  if (baseState === '10' && headState === '11') return RELEASE_ALLOWLISTS.pr204

  if (baseState === '00' && headState === '11') {
    throw new Error(
      'Rejected release transition 00 -> 11: PR #204 cannot bypass the required PR #205 base',
    )
  }

  throw new Error(
    `Rejected release transition ${baseState} -> ${headState}: release markers may not be removed or reordered`,
  )
}

function assertCleanCheckout(repoRoot) {
  const status = runGit(repoRoot, ['status', '--porcelain', '--untracked-files=all'])
  if (status) {
    throw new Error(
      'Checked-out tree is dirty; the release selector must inspect the same committed tree as the delta gate',
    )
  }
}

function main() {
  try {
    const parsed = parseArguments(process.argv.slice(2))
    if (parsed.help) {
      console.log(usage())
      return
    }

    const repoRoot = resolveRepositoryRoot(process.cwd())
    const payload = readPayload(parsed.eventPath)
    const selected = eventRefs(parsed.eventName, payload)
    const checkedHeadRef = requireNonZeroRef(
      parsed.headRef,
      'GITHUB_SHA/--head',
    )

    const baseCommit = resolveCommit(repoRoot, selected.baseRef, 'event base')
    const eventHeadCommit = resolveCommit(
      repoRoot,
      selected.eventHeadRef,
      'event head',
    )
    const checkedHeadCommit = resolveCommit(
      repoRoot,
      checkedHeadRef,
      'checked-out event head',
    )
    const currentHeadCommit = resolveCommit(repoRoot, 'HEAD', 'HEAD')

    if (checkedHeadCommit !== currentHeadCommit) {
      throw new Error(
        `Checked-out HEAD ${currentHeadCommit} does not match GITHUB_SHA/--head ${checkedHeadCommit}`,
      )
    }
    if (
      selected.checkedHeadMayBeMergeCommit
        ? !isAncestor(repoRoot, eventHeadCommit, checkedHeadCommit)
        : eventHeadCommit !== checkedHeadCommit
    ) {
      throw new Error(
        `Event head ${eventHeadCommit} does not match the checked-out head ${checkedHeadCommit}`,
      )
    }
    if (!isAncestor(repoRoot, baseCommit, checkedHeadCommit)) {
      throw new Error(
        `Event base ${baseCommit} is not an ancestor of checked-out head ${checkedHeadCommit}`,
      )
    }

    assertCleanCheckout(repoRoot)

    const baseState = releaseState(repoRoot, baseCommit)
    const headState = releaseState(repoRoot, checkedHeadCommit)
    const allowlist = selectAllowlist(baseState, headState)

    console.log(`Tied-house release event: ${parsed.eventName}`)
    console.log(`Tied-house release refs: base=${baseCommit} head=${checkedHeadCommit}`)
    console.log(`Tied-house release stages: ${baseState} -> ${headState}`)
    console.log(`Tied-house release allowlist: ${allowlist ?? 'none'}`)

    if (parsed.dryRun) {
      console.log('Tied-house release selector dry-run passed.')
      return
    }

    const deltaScript = path.join(
      repoRoot,
      'scripts/security/check-tied-house-delta.mjs',
    )
    const deltaArguments = [deltaScript, '--base', baseCommit]
    if (allowlist) deltaArguments.push('--allowlist', allowlist)

    const result = spawnSync(process.execPath, deltaArguments, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    })
    if (result.error) throw result.error
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) process.exitCode = result.status ?? 2
  } catch (error) {
    console.error(`Tied-house release delta gate could not run: ${error.message}`)
    console.error(usage())
    process.exitCode = 2
  }
}

main()
