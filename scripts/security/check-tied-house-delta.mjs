#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MIGRATION_CUTOFF = '20260601000000'
const TARGETS = [
  'app',
  'lib',
  'components',
  'supabase/migrations',
  'supabase/seeds',
]
const ARCHIVE_ROOTS = ['app', 'lib', 'components', 'supabase']
const FORBIDDEN_PATTERN =
  /kickback|kick_back|kick-back|rev_share|revShare|RevShare|revenue_share|revenueShare|revenue[\s-]+share|bar_split|barSplit|bar_kickback|headcount_kickback|per_head_kickback/i
const MAX_BUFFER = 256 * 1024 * 1024

function usage() {
  return [
    'Usage: node scripts/security/check-tied-house-delta.mjs --base <git-ref> [allowances]',
    '',
    'Allowance options (repeatable and combinable):',
    '  --allow <repo/path::exact trimmed finding text>',
    '  --allowlist <path-to-json>',
    '',
    'An allowlist JSON file must contain an array of objects:',
    '  [{"path":"repo/path","text":"exact trimmed text","count":1}]',
    '',
    'Every allowance must be consumed exactly. Unlisted additions, excess',
    'occurrences, and stale/unused allowances fail the gate.',
  ].join('\n')
}

function parseAllowance(value, source) {
  if (typeof value !== 'string') {
    throw new Error(`${source} must be a string`)
  }

  const separator = value.indexOf('::')
  if (separator <= 0) {
    throw new Error(`${source} must use repo/path::exact trimmed finding text`)
  }

  return normalizeAllowance(
    {
      path: value.slice(0, separator),
      text: value.slice(separator + 2),
      count: 1,
    },
    source,
  )
}

function normalizeRepoPath(value, source) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${source} path must be a non-empty repo-relative path`)
  }

  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${source} path must stay inside the repository`)
  }
  return normalized
}

function normalizeAllowance(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be an object`)
  }

  const normalizedPath = normalizeRepoPath(value.path, source)
  if (typeof value.text !== 'string' || value.text.trim() === '') {
    throw new Error(`${source} text must be a non-empty string`)
  }

  const count = value.count ?? 1
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`${source} count must be a positive integer`)
  }

  return {
    path: normalizedPath,
    text: value.text.trim(),
    count,
    source,
  }
}

function loadAllowlist(repoRoot, filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(repoRoot, filePath)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read allowlist ${filePath}: ${error.message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Allowlist ${filePath} must contain a JSON array`)
  }

  return parsed.map((entry, index) =>
    normalizeAllowance(entry, `${filePath}[${index}]`),
  )
}

function parseArguments(argv) {
  let baseRef = null
  const inlineAllowances = []
  const allowlistPaths = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      return { help: true, baseRef: null, inlineAllowances, allowlistPaths }
    }
    if (argument === '--base') {
      if (baseRef !== null) throw new Error('--base may only be provided once')
      baseRef = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (argument.startsWith('--base=')) {
      if (baseRef !== null) throw new Error('--base may only be provided once')
      baseRef = argument.slice('--base='.length)
      continue
    }
    if (argument === '--allow') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--allow requires a value')
      inlineAllowances.push(parseAllowance(value, '--allow'))
      index += 1
      continue
    }
    if (argument === '--allowlist') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--allowlist requires a path')
      allowlistPaths.push(value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!baseRef) throw new Error('--base <git-ref> is required')
  return { help: false, baseRef, inlineAllowances, allowlistPaths }
}

function runCommand(command, args, options = {}) {
  const encoding = Object.prototype.hasOwnProperty.call(options, 'encoding')
    ? options.encoding
    : 'utf8'
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding,
    maxBuffer: MAX_BUFFER,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr
    const stdout = Buffer.isBuffer(result.stdout)
      ? result.stdout.toString('utf8')
      : result.stdout
    throw new Error(
      `${command} ${args.join(' ')} failed: ${(stderr || stdout || '').trim()}`,
    )
  }
  return result.stdout
}

function resolveRepositoryRoot(cwd) {
  return runCommand('git', ['rev-parse', '--show-toplevel'], { cwd }).trim()
}

function resolveBaseCommit(repoRoot, baseRef) {
  return runCommand(
    'git',
    ['rev-parse', '--verify', `${baseRef}^{commit}`],
    { cwd: repoRoot },
  ).trim()
}

function createBaseSnapshot(repoRoot, baseCommit) {
  const snapshotRoot = mkdtempSync(
    path.join(tmpdir(), '3rdplace-tied-house-delta-base-'),
  )
  const existingRoots = ARCHIVE_ROOTS.filter((root) => {
    const result = spawnSync(
      'git',
      ['cat-file', '-e', `${baseCommit}:${root}`],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    return result.status === 0
  })

  if (existingRoots.length === 0) return snapshotRoot

  const archive = runCommand(
    'git',
    ['archive', '--format=tar', baseCommit, '--', ...existingRoots],
    { cwd: repoRoot, encoding: null },
  )
  runCommand('tar', ['-xf', '-', '-C', snapshotRoot], {
    input: archive,
    encoding: null,
  })
  return snapshotRoot
}

function shouldSkip(relativePath) {
  const segments = relativePath.split('/')
  if (
    segments.some((segment) =>
      ['node_modules', '.next', 'dist', 'build', 'qa-artifacts'].includes(segment),
    )
  ) {
    return true
  }
  if (segments.includes('__tests__')) return true
  if (/\.test\.tsx?$/.test(relativePath)) return true

  if (relativePath.startsWith('supabase/migrations/')) {
    const filename = path.posix.basename(relativePath)
    const version = filename.split('_', 1)[0]
    if (/^\d+$/.test(version) && version < MIGRATION_CUTOFF) return true
  }
  return false
}

function listTargetFiles(root) {
  const files = []

  function walk(absoluteDirectory, relativeDirectory) {
    let entries
    try {
      entries = readdirSync(absoluteDirectory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }

    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      if (shouldSkip(relativePath)) continue

      const absolutePath = path.join(root, ...relativePath.split('/'))
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath)
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath })
      }
    }
  }

  for (const target of TARGETS) {
    walk(path.join(root, ...target.split('/')), target)
  }
  return files
}

function scanStrictFindings(root) {
  const findings = []
  for (const { absolutePath, relativePath } of listTargetFiles(root)) {
    const buffer = readFileSync(absolutePath)
    if (buffer.includes(0)) continue

    const lines = buffer.toString('utf8').split(/\n/)
    lines.forEach((line, index) => {
      const text = line.replace(/\r$/, '')
      if (!FORBIDDEN_PATTERN.test(text)) return
      findings.push({
        path: relativePath,
        line: index + 1,
        text,
        normalizedText: text.trim(),
      })
    })
  }

  return findings.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.text.localeCompare(right.text),
  )
}

function findingKey(value) {
  return `${value.path}\u0000${value.normalizedText ?? value.text.trim()}`
}

function groupByFinding(findings) {
  const grouped = new Map()
  for (const finding of findings) {
    const key = findingKey(finding)
    const existing = grouped.get(key) ?? []
    existing.push(finding)
    grouped.set(key, existing)
  }
  return grouped
}

function calculateDelta(baseFindings, currentFindings) {
  const baseGroups = groupByFinding(baseFindings)
  const currentGroups = groupByFinding(currentFindings)
  const additions = []
  let inherited = 0

  for (const [key, current] of currentGroups) {
    const baseCount = baseGroups.get(key)?.length ?? 0
    inherited += Math.min(baseCount, current.length)
    if (current.length > baseCount) additions.push(...current.slice(baseCount))
  }

  return {
    additions,
    inherited,
    removed: baseFindings.length - inherited,
  }
}

function buildAllowanceCounts(allowances) {
  const counts = new Map()
  for (const allowance of allowances) {
    const key = findingKey({
      path: allowance.path,
      normalizedText: allowance.text,
    })
    const current = counts.get(key) ?? { allowance, count: 0 }
    current.count += allowance.count
    counts.set(key, current)
  }
  return counts
}

function reviewAdditions(additions, allowances) {
  const allowanceCounts = buildAllowanceCounts(allowances)
  const usedCounts = new Map()
  const allowed = []
  const unlisted = []

  for (const finding of additions) {
    const key = findingKey(finding)
    const capacity = allowanceCounts.get(key)?.count ?? 0
    const used = usedCounts.get(key) ?? 0
    if (used < capacity) {
      allowed.push(finding)
      usedCounts.set(key, used + 1)
    } else {
      unlisted.push(finding)
    }
  }

  const unused = []
  for (const [key, value] of allowanceCounts) {
    const remaining = value.count - (usedCounts.get(key) ?? 0)
    if (remaining > 0) unused.push({ ...value.allowance, count: remaining })
  }

  return { allowed, unlisted, unused }
}

function formatFinding(finding) {
  return `${finding.path}:${finding.line}: ${finding.normalizedText}`
}

function main() {
  let snapshotRoot = null
  try {
    const parsed = parseArguments(process.argv.slice(2))
    if (parsed.help) {
      console.log(usage())
      return
    }

    const repoRoot = resolveRepositoryRoot(process.cwd())
    const baseCommit = resolveBaseCommit(repoRoot, parsed.baseRef)
    const allowances = [
      ...parsed.inlineAllowances,
      ...parsed.allowlistPaths.flatMap((filePath) =>
        loadAllowlist(repoRoot, filePath),
      ),
    ]

    snapshotRoot = createBaseSnapshot(repoRoot, baseCommit)
    const baseFindings = scanStrictFindings(snapshotRoot)
    const currentFindings = scanStrictFindings(repoRoot)
    const delta = calculateDelta(baseFindings, currentFindings)
    const review = reviewAdditions(delta.additions, allowances)

    console.log(`Tied-house delta base: ${parsed.baseRef} (${baseCommit})`)
    console.log(
      `Strict findings: base=${baseFindings.length} current=${currentFindings.length} inherited=${delta.inherited} removed=${delta.removed} new=${delta.additions.length}`,
    )
    console.log(
      `Reviewed additions: allowed=${review.allowed.length} unlisted=${review.unlisted.length} unused_allowances=${review.unused.reduce((total, entry) => total + entry.count, 0)}`,
    )
    console.log(
      `Inherited strict findings remain: ${delta.inherited}; run npm run security:tied-house:strict for the complete current list.`,
    )

    for (const finding of review.allowed) {
      console.log(`ALLOWED ${formatFinding(finding)}`)
    }
    for (const finding of review.unlisted) {
      console.error(`UNLISTED ${formatFinding(finding)}`)
    }
    for (const allowance of review.unused) {
      console.error(
        `UNUSED ${allowance.path}::${allowance.text} (${allowance.count} occurrence${allowance.count === 1 ? '' : 's'})`,
      )
    }

    if (review.unlisted.length > 0 || review.unused.length > 0) {
      console.error('Tied-house delta check failed.')
      process.exitCode = 1
      return
    }

    console.log('Tied-house delta check passed.')
  } catch (error) {
    console.error(`Tied-house delta check could not run: ${error.message}`)
    console.error(usage())
    process.exitCode = 2
  } finally {
    if (snapshotRoot) rmSync(snapshotRoot, { recursive: true, force: true })
  }
}

main()
