import 'server-only'

type AdminDb = { from: (table: string) => any }

interface HealthRow {
  id?: string
  status?: string | null
  outcome?: string | null
  error?: string | null
  created_at?: string | null
  scheduled_at?: string | null
  [key: string]: unknown
}

async function safeQuery<T extends HealthRow>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const { data, error } = await query
  if (error) {
    console.warn(`[admin.health] ${label} unavailable`, error)
    return []
  }

  return Array.isArray(data) ? data : []
}

/**
 * Loads lightweight health counters for admin operations monitoring.
 */
export async function getAdminHealthData(admin: AdminDb) {
  const staleCutoff = new Date(Date.now() - 15 * 60_000).toISOString()
  const [
    failedJobs,
    stuckJobs,
    webhookLogs,
    recentErrors,
    recentActionTransitions,
  ] = await Promise.all([
    safeQuery(
      'failed jobs',
      admin
        .from('app_jobs')
        .select('id, job_type, status, attempts, max_attempts, error, scheduled_at, created_at, updated_at')
        .in('status', ['failed', 'dead'])
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'stuck jobs',
      admin
        .from('app_jobs')
        .select('id, job_type, status, attempts, max_attempts, error, scheduled_at, created_at, updated_at')
        .eq('status', 'pending')
        .lte('scheduled_at', staleCutoff)
        .order('scheduled_at', { ascending: true })
        .limit(30)
    ),
    safeQuery(
      'webhook logs',
      admin
        .from('webhook_logs')
        .select('id, source, event_type, entity_type, entity_id, provider, outcome, status_code, error, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
    ),
    safeQuery(
      'error logs',
      admin
        .from('error_logs')
        .select('id, user_id, source, message, path, user_agent, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
    safeQuery(
      'agent action transitions',
      admin
        .from('agent_action_audit_log')
        .select('id, action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ),
  ])

  const failedWebhookLogs = webhookLogs.filter((log) =>
    ['provider_failure', 'failed', 'error'].includes(String(log.outcome ?? '').toLowerCase())
  )

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      failedJobs: failedJobs.length,
      stuckJobs: stuckJobs.length,
      failedWebhookLogs: failedWebhookLogs.length,
      recentErrors: recentErrors.length,
      recentActionTransitions: recentActionTransitions.length,
    },
    failedJobs,
    stuckJobs,
    failedWebhookLogs,
    recentErrors,
    recentActionTransitions,
  }
}
