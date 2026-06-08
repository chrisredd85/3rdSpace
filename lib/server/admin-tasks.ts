import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ADMIN_TASK_PRIORITIES,
  ADMIN_TASK_STATUSES,
  ADMIN_TASK_TYPES,
  canMutateAdminTaskStatus,
  transitionAdminTaskStatus,
  type AdminTaskMutationAction,
} from '@/lib/admin/taskState'
import type { Database, Json } from '@/lib/types/database-generated'
import type { AdminTaskPriority, AdminTaskStatus, AdminTaskType } from '@/lib/types/planner'

export type AdminTasksDb = SupabaseClient<Database, 'public'>

type AdminTaskRow = Database['public']['Tables']['admin_tasks']['Row']
type AdminTaskUpdate = Database['public']['Tables']['admin_tasks']['Update']
type PlanRow = Pick<
  Database['public']['Tables']['plans']['Row'],
  'id' | 'title' | 'user_id' | 'guest_count' | 'neighborhood' | 'date_window_start' | 'date_window_end' | 'event_type' | 'status'
>
type UserRow = Pick<Database['public']['Tables']['users']['Row'], 'id' | 'email' | 'company_name' | 'role' | 'user_type'>
type JsonObject = Record<string, Json>

export interface AdminTaskQueueFilters {
  status?: AdminTaskStatus
  priority?: AdminTaskPriority
  taskType?: AdminTaskType
  planId?: string
}

export interface AdminTaskQueueRow {
  id: string
  planId: string
  assignedTo: string | null
  taskType: AdminTaskType
  description: string
  status: AdminTaskStatus
  priority: AdminTaskPriority
  metadata: JsonObject
  dueAt: string | null
  completedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  plan: {
    id: string
    title: string
    userId: string
    guestCount: number | null
    neighborhood: string | null
    dateWindowStart: string | null
    dateWindowEnd: string | null
    eventType: string | null
    status: string
  } | null
  assignee: {
    id: string
    email: string
    companyName: string | null
    role: string
    userType: string | null
  } | null
}

export interface AdminTaskQueueData {
  generatedAt: string
  rows: AdminTaskQueueRow[]
}

export type AdminTaskMutationInput =
  | {
      taskId: string
      adminUserId: string
      adminUserEmail: string | null
      action: 'assign'
      assignedTo: string | null
    }
  | {
      taskId: string
      adminUserId: string
      adminUserEmail: string | null
      action: 'start'
    }
  | {
      taskId: string
      adminUserId: string
      adminUserEmail: string | null
      action: 'complete' | 'cancel'
      note?: string | null
    }
  | {
      taskId: string
      adminUserId: string
      adminUserEmail: string | null
      action: 'append_note'
      note: string
    }

export class AdminTaskServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 500
  ) {
    super(message)
    this.name = 'AdminTaskServiceError'
  }
}

const ADMIN_TASK_SELECT =
  'id, plan_id, assigned_to, task_type, description, status, priority, metadata, due_at, completed_at, notes, created_at, updated_at'
const PLAN_SELECT = 'id, title, user_id, guest_count, neighborhood, date_window_start, date_window_end, event_type, status'
const USER_SELECT = 'id, email, company_name, role, user_type'

export async function getAdminTaskQueueData(
  admin: AdminTasksDb,
  filters: AdminTaskQueueFilters = {}
): Promise<AdminTaskQueueData> {
  let query = admin.from('admin_tasks').select(ADMIN_TASK_SELECT)

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.priority) query = query.eq('priority', filters.priority)
  if (filters.taskType) query = query.eq('task_type', filters.taskType)
  if (filters.planId) query = query.eq('plan_id', filters.planId)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(250)

  if (error) throw new AdminTaskServiceError(`Failed to load admin tasks: ${error.message}`)

  const rows = (data ?? []) as AdminTaskRow[]
  const planIds = Array.from(new Set(rows.map((row) => row.plan_id).filter(Boolean)))
  const assigneeIds = Array.from(new Set(rows.map((row) => row.assigned_to).filter((id): id is string => Boolean(id))))

  const [plans, users] = await Promise.all([
    loadPlans(admin, planIds),
    loadUsers(admin, assigneeIds),
  ])

  return {
    generatedAt: new Date().toISOString(),
    rows: rows.map((row) => normalizeAdminTaskRow(row, plans.get(row.plan_id) ?? null, row.assigned_to ? users.get(row.assigned_to) ?? null : null)),
  }
}

export async function mutateAdminTask(admin: AdminTasksDb, input: AdminTaskMutationInput): Promise<AdminTaskQueueRow> {
  const before = await loadAdminTask(admin, input.taskId)
  const status = normalizeStatus(before.status)
  const actionCheck = canMutateAdminTaskStatus(status, input.action)

  if (!actionCheck.ok) {
    throw new AdminTaskServiceError(actionCheck.reason, 409)
  }

  const now = new Date().toISOString()
  const update = buildTaskUpdate(before, input, now)

  const { data: after, error: updateError } = await admin
    .from('admin_tasks')
    .update(update)
    .eq('id', input.taskId)
    .select(ADMIN_TASK_SELECT)
    .single()

  if (updateError || !after) {
    throw new AdminTaskServiceError(`Failed to update admin task: ${updateError?.message ?? 'not found'}`)
  }

  await logAdminTaskAudit(admin, input, before, after as AdminTaskRow, update)

  return normalizeAdminTaskRow(after as AdminTaskRow, null, null)
}

function buildTaskUpdate(before: AdminTaskRow, input: AdminTaskMutationInput, now: string): AdminTaskUpdate {
  if (input.action === 'assign') {
    return { assigned_to: input.assignedTo }
  }

  if (input.action === 'append_note') {
    return { notes: appendTaskNote(before.notes, input.note, input.adminUserEmail, now) }
  }

  const transition = transitionAdminTaskStatus(normalizeStatus(before.status), input.action)
  if (!transition.ok) {
    throw new AdminTaskServiceError(transition.reason, 409)
  }

  const update: AdminTaskUpdate = { status: transition.toStatus }

  if (input.action === 'complete') {
    update.completed_at = now
  }

  if ('note' in input && input.note?.trim()) {
    update.notes = appendTaskNote(before.notes, input.note, input.adminUserEmail, now)
  }

  return update
}

function appendTaskNote(existingNotes: string | null, note: string, adminEmail: string | null, now: string) {
  const trimmed = note.trim()
  if (!trimmed) return existingNotes

  const noteBlock = `[${now}] ${adminEmail ?? 'admin'}\n${trimmed}`
  return [existingNotes?.trim(), noteBlock].filter(Boolean).join('\n\n')
}

async function loadAdminTask(admin: AdminTasksDb, taskId: string) {
  const { data, error } = await admin
    .from('admin_tasks')
    .select(ADMIN_TASK_SELECT)
    .eq('id', taskId)
    .single()

  if (error || !data) {
    throw new AdminTaskServiceError(`Admin task not found: ${error?.message ?? taskId}`, 404)
  }

  return data as AdminTaskRow
}

async function loadPlans(admin: AdminTasksDb, planIds: string[]) {
  if (planIds.length === 0) return new Map<string, PlanRow>()

  const { data, error } = await admin.from('plans').select(PLAN_SELECT).in('id', planIds)
  if (error) throw new AdminTaskServiceError(`Failed to load task plans: ${error.message}`)

  return new Map(((data ?? []) as PlanRow[]).map((plan) => [plan.id, plan]))
}

async function loadUsers(admin: AdminTasksDb, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, UserRow>()

  const { data, error } = await admin.from('users').select(USER_SELECT).in('id', userIds)
  if (error) throw new AdminTaskServiceError(`Failed to load task assignees: ${error.message}`)

  return new Map(((data ?? []) as UserRow[]).map((user) => [user.id, user]))
}

async function logAdminTaskAudit(
  admin: AdminTasksDb,
  input: AdminTaskMutationInput,
  before: AdminTaskRow,
  after: AdminTaskRow,
  update: AdminTaskUpdate
) {
  const metadata: JsonObject = {
    action: input.action,
    changed_fields: Object.keys(update) as Json,
  }

  if (input.action === 'assign') metadata.assigned_to = input.assignedTo
  if ('note' in input) metadata.note_added = Boolean(input.note?.trim())

  const { error } = await admin.from('admin_audit_log').insert({
    admin_user_id: input.adminUserId,
    action: `admin_tasks.${input.action}`,
    entity_type: 'admin_task',
    entity_id: input.taskId,
    before_state: toJson(before),
    after_state: toJson(after),
    metadata,
  })

  if (error) throw new AdminTaskServiceError(`Failed to write admin task audit log: ${error.message}`)
}

function normalizeAdminTaskRow(row: AdminTaskRow, plan: PlanRow | null, assignee: UserRow | null): AdminTaskQueueRow {
  return {
    id: row.id,
    planId: row.plan_id,
    assignedTo: row.assigned_to,
    taskType: normalizeTaskType(row.task_type),
    description: row.description,
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority),
    metadata: normalizeMetadata(row.metadata),
    dueAt: row.due_at,
    completedAt: row.completed_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    plan: plan
      ? {
          id: plan.id,
          title: plan.title,
          userId: plan.user_id,
          guestCount: plan.guest_count,
          neighborhood: plan.neighborhood,
          dateWindowStart: plan.date_window_start,
          dateWindowEnd: plan.date_window_end,
          eventType: plan.event_type,
          status: plan.status,
        }
      : null,
    assignee: assignee
      ? {
          id: assignee.id,
          email: assignee.email,
          companyName: assignee.company_name,
          role: assignee.role,
          userType: assignee.user_type,
        }
      : null,
  }
}

function normalizeStatus(value: string): AdminTaskStatus {
  return includesValue(ADMIN_TASK_STATUSES, value) ? value : 'open'
}

function normalizePriority(value: string): AdminTaskPriority {
  return includesValue(ADMIN_TASK_PRIORITIES, value) ? value : 'normal'
}

function normalizeTaskType(value: string): AdminTaskType {
  return includesValue(ADMIN_TASK_TYPES, value) ? value : 'concierge_booking'
}

function normalizeMetadata(value: Json): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined))
  }

  return {}
}

function includesValue<const Values extends readonly string[]>(
  values: Values,
  value: string
): value is Values[number] {
  return values.includes(value)
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}
