const args = new Set(process.argv.slice(2))
const once = args.has('--once')
const intervalArg = process.argv.find((arg) => arg.startsWith('--interval='))
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const intervalMs = Math.max(Number(intervalArg?.split('=')[1] || 5000) || 5000, 1000)
const limit = Math.min(Math.max(Number(limitArg?.split('=')[1] || 10) || 10, 1), 25)

const baseUrl = (process.env.WORKER_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const localWorkerSecret = 'local-dev-worker-secret'
const workerSecret = process.env.WORKER_SECRET || (process.env.NODE_ENV === 'production' ? '' : localWorkerSecret)

if (!workerSecret) {
  console.error('WORKER_SECRET is required to run the job worker.')
  process.exit(1)
}

if (!process.env.WORKER_SECRET) {
  console.warn('[job-worker] WORKER_SECRET is not set; using the local development worker token.')
}

async function runBatch() {
  const response = await fetch(`${baseUrl}/api/internal/jobs/run?limit=${limit}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${workerSecret}`,
    },
  })

  const text = await response.text()
  const body = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(body.error || `Worker request failed with ${response.status}`)
  }

  const claimed = typeof body.claimed === 'number' ? body.claimed : 0
  console.log(`[job-worker] claimed=${claimed} results=${JSON.stringify(body.results || [])}`)
}

async function main() {
  do {
    try {
      await runBatch()
    } catch (error) {
      console.error('[job-worker] batch failed', error instanceof Error ? error.message : error)
      if (once) process.exit(1)
    }

    if (!once) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  } while (!once)
}

main()
