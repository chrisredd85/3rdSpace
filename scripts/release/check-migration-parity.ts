import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_VERSION = /^([0-9]{14})_.+\.sql$/

export type MigrationList = {
  localVersions: string[]
  remoteVersions: string[]
}

export type MigrationParity = {
  ok: boolean
  missingRemote: string[]
  unexpectedRemote: string[]
  disallowedMissing: string[]
  staleAllowedMissing: string[]
}

export function readExpectedMigrationVersions(migrationsDirectory: string): string[] {
  const entries = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()

  const invalid = sqlFiles.filter((file) => !MIGRATION_VERSION.test(file))
  if (invalid.length > 0) {
    throw new Error(`Migration files must start with a 14-digit version: ${invalid.join(', ')}`)
  }

  const versions = sqlFiles.map((file) => file.match(MIGRATION_VERSION)?.[1] as string)
  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)
  if (duplicates.length > 0) {
    throw new Error(`Duplicate migration versions: ${Array.from(new Set(duplicates)).join(', ')}`)
  }
  return versions
}

export function parseSupabaseMigrationList(output: string): MigrationList {
  const localVersions = new Set<string>()
  const remoteVersions = new Set<string>()

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('|')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 3) {
      throw new Error(`Malformed migration ledger row: ${line.trim()}`)
    }

    const [localVersion, remoteVersion] = cells
    if (localVersion === 'Local' && remoteVersion === 'Remote') continue
    if (/^-+$/.test(localVersion) && /^-+$/.test(remoteVersion)) continue
    if (!localVersion && !remoteVersion) continue

    for (const [label, version] of [['local', localVersion], ['remote', remoteVersion]] as const) {
      if (version && !/^[0-9]{14}$/.test(version)) {
        throw new Error(`Invalid ${label} migration version in ledger: ${version}`)
      }
    }

    if (localVersion) localVersions.add(localVersion)
    if (remoteVersion) remoteVersions.add(remoteVersion)
  }

  if (localVersions.size === 0 && remoteVersions.size === 0) {
    throw new Error('Could not parse any migration rows from `supabase migration list` output')
  }

  return {
    localVersions: Array.from(localVersions).sort(),
    remoteVersions: Array.from(remoteVersions).sort(),
  }
}

export function compareMigrationParity(
  expectedVersions: string[],
  remoteVersions: string[],
  allowedMissingVersions: string[] = []
): MigrationParity {
  const expected = new Set(expectedVersions)
  const remote = new Set(remoteVersions)
  const allowedMissing = new Set(allowedMissingVersions)
  const missingRemote = expectedVersions.filter((version) => !remote.has(version))
  const unexpectedRemote = remoteVersions.filter((version) => !expected.has(version))
  const disallowedMissing = missingRemote.filter((version) => !allowedMissing.has(version))
  const staleAllowedMissing = allowedMissingVersions.filter((version) => !missingRemote.includes(version))

  return {
    ok: disallowedMissing.length === 0 && unexpectedRemote.length === 0 && staleAllowedMissing.length === 0,
    missingRemote,
    unexpectedRemote,
    disallowedMissing,
    staleAllowedMissing,
  }
}

function readLedger(options: CliOptions): string {
  if (options.ledgerFile) return fs.readFileSync(options.ledgerFile, 'utf8')

  const args = ['migration', 'list', options.local ? '--local' : '--linked']
  if (!options.local && process.env.SUPABASE_DB_PASSWORD) {
    args.push('--password', process.env.SUPABASE_DB_PASSWORD)
  }

  const result = spawnSync('supabase', args, {
    cwd: options.rootDirectory,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error([
      '`supabase migration list` failed.',
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'))
  }
  return result.stdout
}

type CliOptions = {
  rootDirectory: string
  ledgerFile?: string
  local: boolean
  allowedMissingVersions: string[]
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    rootDirectory: process.cwd(),
    local: false,
    allowedMissingVersions: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--local') {
      options.local = true
      continue
    }
    if (argument === '--linked') {
      options.local = false
      continue
    }
    if (argument === '--ledger-file') {
      options.ledgerFile = requireValue(argv, ++index, argument)
      continue
    }
    if (argument === '--root') {
      options.rootDirectory = path.resolve(requireValue(argv, ++index, argument))
      continue
    }
    if (argument === '--expect-missing') {
      options.allowedMissingVersions.push(...requireValue(argv, ++index, argument).split(',').filter(Boolean))
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return options
}

function requireValue(argv: string[], index: number, argument: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${argument} requires a value`)
  return value
}

function main() {
  const options = parseCliArgs(process.argv.slice(2))
  const expected = readExpectedMigrationVersions(path.join(options.rootDirectory, 'supabase/migrations'))
  const ledger = parseSupabaseMigrationList(readLedger(options))
  const parity = compareMigrationParity(expected, ledger.remoteVersions, options.allowedMissingVersions)

  console.log(`Expected migrations: ${expected.length}`)
  console.log(`${options.local ? 'Local realized' : 'Hosted'} ledger migrations: ${ledger.remoteVersions.length}`)

  if (parity.missingRemote.length > 0) {
    console.log(`Missing remotely: ${parity.missingRemote.join(', ')}`)
  }
  if (parity.unexpectedRemote.length > 0) {
    console.error(`Remote-only migrations: ${parity.unexpectedRemote.join(', ')}`)
  }
  if (parity.staleAllowedMissing.length > 0) {
    console.error(`Expected-missing versions are not missing: ${parity.staleAllowedMissing.join(', ')}`)
  }

  if (!parity.ok) {
    throw new Error(`${options.local ? 'Local realized' : 'Hosted'} migration ledger does not match the deployed commit`)
  }

  if (parity.missingRemote.length > 0) {
    console.log('Preflight passed: drift is limited to the explicitly expected migration list.')
    return
  }
  console.log('Migration parity passed: deployed code and hosted ledger match exactly.')
}

const isCliInvocation = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCliInvocation) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
