import { redirect } from 'next/navigation'
import { AdminTaskQueueConsole } from '@/components/admin/AdminTaskQueueConsole'
import { ADMIN_TASK_PRIORITIES, ADMIN_TASK_STATUSES, ADMIN_TASK_TYPES } from '@/lib/admin/taskState'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminTaskQueueData, type AdminTaskQueueFilters } from '@/lib/server/admin-tasks'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { AdminTaskPriority, AdminTaskStatus, AdminTaskType } from '@/lib/types/planner'

export const dynamic = 'force-dynamic'

interface AdminTasksPageProps {
  searchParams?: {
    status?: string
    priority?: string
    task_type?: string
    plan_id?: string
  }
}

/**
 * Admin-only queue for general Concierge/Admin Queue planner handoffs.
 */
export default async function AdminTasksPage({ searchParams }: AdminTasksPageProps) {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const data = await getAdminTaskQueueData(createServiceRoleClient(), buildFilters(searchParams))

  return (
    <AdminTaskQueueConsole
      initialData={data}
      currentAdmin={{ id: context.user.id, email: context.user.email }}
    />
  )
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}

function buildFilters(searchParams: AdminTasksPageProps['searchParams']): AdminTaskQueueFilters {
  return {
    status: includesValue(ADMIN_TASK_STATUSES, searchParams?.status) ? searchParams.status : undefined,
    priority: includesValue(ADMIN_TASK_PRIORITIES, searchParams?.priority) ? searchParams.priority : undefined,
    taskType: includesValue(ADMIN_TASK_TYPES, searchParams?.task_type) ? searchParams.task_type : undefined,
    planId: searchParams?.plan_id || undefined,
  }
}

function includesValue(values: typeof ADMIN_TASK_STATUSES, value: string | undefined): value is AdminTaskStatus
function includesValue(values: typeof ADMIN_TASK_PRIORITIES, value: string | undefined): value is AdminTaskPriority
function includesValue(values: typeof ADMIN_TASK_TYPES, value: string | undefined): value is AdminTaskType
function includesValue(values: readonly string[], value: string | undefined) {
  return typeof value === 'string' && values.includes(value)
}
