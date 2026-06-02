import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const allowRemote = process.argv.includes('--allow-remote')

function readLinkedProjectRef() {
  const projectRefPath = path.join(process.cwd(), 'supabase', '.temp', 'project-ref')
  if (!existsSync(projectRefPath)) return null
  const value = readFileSync(projectRefPath, 'utf8').trim()
  return value || null
}

function readLinkedPoolerUrl() {
  const poolerUrlPath = path.join(process.cwd(), 'supabase', '.temp', 'pooler-url')
  if (!existsSync(poolerUrlPath)) return null
  const value = readFileSync(poolerUrlPath, 'utf8').trim()
  return value || null
}

type DatabaseConnection = {
  url: string
  password?: string
}

function splitPasswordFromUrl(value: string): DatabaseConnection {
  const url = new URL(value)
  const password = url.password ? decodeURIComponent(url.password) : undefined
  url.password = ''
  return { url: url.toString(), password }
}

function isLocalDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function refuseRemote(reason: string): void {
  if (allowRemote) {
    console.warn(`Remote RLS check allowed by --allow-remote: ${reason}`)
    return
  }

  console.error(`Refusing to run RLS check against a non-local database: ${reason}`)
  console.error('Use a local Supabase database, or pass --allow-remote if you intentionally want to inspect a remote project.')
  process.exit(1)
}

function assertLocalUrl(envName: string, value: string): void {
  if (!isLocalDatabaseUrl(value)) {
    refuseRemote(`${envName} points to ${redactConnectionString(value)}`)
  }
}

function redactConnectionString(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://[redacted]@')
}

function resolveDatabaseConnection(): DatabaseConnection {
  if (process.env.SUPABASE_PROJECT_REF) {
    refuseRemote('SUPABASE_PROJECT_REF is set')
  }

  if (process.env.DATABASE_URL) {
    assertLocalUrl('DATABASE_URL', process.env.DATABASE_URL)
    return splitPasswordFromUrl(process.env.DATABASE_URL)
  }

  if (process.env.SUPABASE_DB_URL) {
    assertLocalUrl('SUPABASE_DB_URL', process.env.SUPABASE_DB_URL)
    return splitPasswordFromUrl(process.env.SUPABASE_DB_URL)
  }

  const password = process.env.SUPABASE_DB_PASSWORD
  const poolerUrl = readLinkedPoolerUrl()
  if (password && poolerUrl) {
    assertLocalUrl('linked Supabase pooler URL', poolerUrl)
    const url = new URL(poolerUrl)
    url.searchParams.set('sslmode', 'require')
    return { url: url.toString(), password }
  }

  const projectRef = process.env.SUPABASE_PROJECT_REF || readLinkedProjectRef()
  if (password && projectRef) {
    refuseRemote('SUPABASE_DB_PASSWORD is set with a linked Supabase project ref')
    return {
      url: `postgresql://postgres@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
      password,
    }
  }

  return splitPasswordFromUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')
}

const query = `
COPY (
  SELECT namespace.nspname || '.' || relation.relname
  FROM pg_class relation
  JOIN pg_namespace namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relrowsecurity = false
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      JOIN pg_extension extension
        ON extension.oid = dependency.refobjid
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )
  ORDER BY relation.relname
) TO STDOUT
`

try {
  const connection = resolveDatabaseConnection()
  const output = execFileSync('psql', [
    connection.url,
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    query,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(connection.password ? { PGPASSWORD: connection.password } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

  if (output) {
    console.error('RLS is disabled for public tables:')
    console.error(output)
    process.exit(1)
  }

  console.log('RLS check passed: every public table has row-level security enabled.')
} catch (error) {
  const detail = error instanceof Error ? redactConnectionString(error.message) : String(error)
  console.error(`RLS check failed to inspect the database: ${detail}`)
  process.exit(1)
}
