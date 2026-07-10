'use client'

import { useMemo, useState } from 'react'
import { Ban, CheckCircle2, ClipboardList, Loader2, Play, RefreshCw, Search, UserPlus } from 'lucide-react'
import {
  ADMIN_TASK_PRIORITIES,
  ADMIN_TASK_STATUSES,
  ADMIN_TASK_TYPES,
  canMutateAdminTaskStatus,
} from '@/lib/admin/taskState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { AdminTaskQueueData, AdminTaskQueueRow } from '@/lib/server/admin-tasks'
import type { AdminTaskPriority, AdminTaskStatus, AdminTaskType } from '@/lib/types/planner'

type StatusFilter = 'all' | AdminTaskStatus
type PriorityFilter = 'all' | AdminTaskPriority
type TaskTypeFilter = 'all' | AdminTaskType

interface AdminTaskQueueConsoleProps {
  initialData: AdminTaskQueueData
  currentAdmin: {
    id: string
    email: string | null
  }
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatTaskType(value: AdminTaskType) {
  return value
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function statusTone(status: AdminTaskStatus) {
  if (status === 'complete') return 'border-success/30 bg-success/10 text-success'
  if (status === 'cancelled') return 'border-muted-foreground/30 bg-muted text-muted-foreground'
  if (status === 'in_progress') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'pending') return 'border-warning/30 bg-warning/10 text-warning'
  return 'border-border bg-background text-foreground'
}

function priorityTone(priority: AdminTaskPriority) {
  if (priority === 'urgent') return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (priority === 'high') return 'border-warning/30 bg-warning/10 text-warning'
  if (priority === 'low') return 'border-border bg-muted text-muted-foreground'
  return 'border-border bg-background text-foreground'
}

/**
 * General admin queue for planner tasks that require human execution.
 */
export function AdminTaskQueueConsole({ initialData, currentAdmin }: AdminTaskQueueConsoleProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>('all')
  const [planFilter, setPlanFilter] = useState('')
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [assigneeByTask, setAssigneeByTask] = useState<Record<string, string>>({})
  const [noteByTask, setNoteByTask] = useState<Record<string, string>>({})
  const [hostMessageByTask, setHostMessageByTask] = useState<Record<string, string>>({})
  const [outcomeByTask, setOutcomeByTask] = useState<Record<string, string>>({})

  const filteredRows = useMemo(() => {
    const planNeedle = planFilter.trim().toLowerCase()

    return initialData.rows.filter((task) => {
      const statusMatches = statusFilter === 'all' || task.status === statusFilter
      const priorityMatches = priorityFilter === 'all' || task.priority === priorityFilter
      const typeMatches = taskTypeFilter === 'all' || task.taskType === taskTypeFilter
      const planMatches =
        !planNeedle ||
        task.planId.toLowerCase().includes(planNeedle) ||
        task.description.toLowerCase().includes(planNeedle) ||
        (task.plan?.title.toLowerCase().includes(planNeedle) ?? false)

      return statusMatches && priorityMatches && typeMatches && planMatches
    })
  }, [initialData.rows, planFilter, priorityFilter, statusFilter, taskTypeFilter])

  const counts = useMemo(() => {
    return initialData.rows.reduce(
      (acc, task) => {
        acc.total += 1
        if (task.status === 'pending' || task.status === 'open') acc.open += 1
        if (task.status === 'in_progress') acc.inProgress += 1
        if (task.priority === 'urgent') acc.urgent += 1
        return acc
      },
      { total: 0, open: 0, inProgress: 0, urgent: 0 }
    )
  }, [initialData.rows])

  async function refresh() {
    window.location.reload()
  }

  async function mutateTask(task: AdminTaskQueueRow, body: Record<string, unknown>, successMessage: string) {
    setBusyTaskId(task.id)
    setMessage(null)

    try {
      const response = await fetch(`/api/admin/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) throw new Error(payload.error || 'Task update failed.')

      setMessage(successMessage)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Task update failed.')
    } finally {
      setBusyTaskId(null)
    }
  }

  function taskNote(task: AdminTaskQueueRow) {
    return noteByTask[task.id]?.trim() ?? ''
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="mt-2 font-display text-4xl font-bold">Admin task queue</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Planner handoffs for Concierge/Admin Queue execution, catalog gaps, vendor confirmation, receipts, and compliance follow-up.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric label="Total" value={counts.total} />
          <Metric label="Open" value={counts.open} />
          <Metric label="In progress" value={counts.inProgress} />
          <Metric label="Urgent" value={counts.urgent} />
        </section>

        {message ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">{message}</div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_220px]">
            <label className="text-sm font-semibold text-foreground">
              Plan
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={planFilter}
                  onChange={(event) => setPlanFilter(event.target.value)}
                  className="pl-9"
                  placeholder="Title, plan id, or task text"
                />
              </div>
            </label>
            <label className="text-sm font-semibold text-foreground">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                {ADMIN_TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-foreground">
              Priority
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                {ADMIN_TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-foreground">
              Task type
              <select
                value={taskTypeFilter}
                onChange={(event) => setTaskTypeFilter(event.target.value as TaskTypeFilter)}
                className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All</option>
                {ADMIN_TASK_TYPES.map((taskType) => (
                  <option key={taskType} value={taskType}>
                    {formatTaskType(taskType)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1240px] text-left text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                      No admin tasks match these filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      currentAdmin={currentAdmin}
                      busy={busyTaskId === task.id}
                      assigneeValue={assigneeByTask[task.id] ?? ''}
                      noteValue={noteByTask[task.id] ?? ''}
                      hostMessageValue={hostMessageByTask[task.id] ?? ''}
                      outcomeValue={outcomeByTask[task.id] ?? ''}
                      onAssigneeChange={(value) => setAssigneeByTask((current) => ({ ...current, [task.id]: value }))}
                      onNoteChange={(value) => setNoteByTask((current) => ({ ...current, [task.id]: value }))}
                      onHostMessageChange={(value) => setHostMessageByTask((current) => ({ ...current, [task.id]: value }))}
                      onOutcomeChange={(value) => setOutcomeByTask((current) => ({ ...current, [task.id]: value }))}
                      onMutate={mutateTask}
                      getTaskNote={taskNote}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold">{value}</p>
    </div>
  )
}

interface TaskRowProps {
  task: AdminTaskQueueRow
  currentAdmin: {
    id: string
    email: string | null
  }
  busy: boolean
  assigneeValue: string
  noteValue: string
  hostMessageValue: string
  outcomeValue: string
  onAssigneeChange: (value: string) => void
  onNoteChange: (value: string) => void
  onHostMessageChange: (value: string) => void
  onOutcomeChange: (value: string) => void
  onMutate: (task: AdminTaskQueueRow, body: Record<string, unknown>, successMessage: string) => Promise<void>
  getTaskNote: (task: AdminTaskQueueRow) => string
}

function TaskRow({
  task,
  currentAdmin,
  busy,
  assigneeValue,
  noteValue,
  hostMessageValue,
  outcomeValue,
  onAssigneeChange,
  onNoteChange,
  onHostMessageChange,
  onOutcomeChange,
  onMutate,
  getTaskNote,
}: TaskRowProps) {
  const canAssign = canMutateAdminTaskStatus(task.status, 'assign').ok
  const canStart = canMutateAdminTaskStatus(task.status, 'start').ok
  const canComplete = canMutateAdminTaskStatus(task.status, 'complete').ok
  const canCancel = canMutateAdminTaskStatus(task.status, 'cancel').ok
  const note = getTaskNote(task)
  const isVenueHold = task.metadata.execution_action_type === 'hold_request'
  const completionOutcome = isVenueHold ? outcomeValue : 'completed'
  const canSubmitCompletion = canComplete && (!isVenueHold || completionOutcome.length > 0)

  return (
    <tr>
      <td className="max-w-sm px-4 py-4 align-top">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-1 h-5 w-5 flex-none text-primary" />
          <div>
            <p className="font-semibold text-foreground">{task.description}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-border bg-background px-2.5 py-1 text-xs font-bold">
                {formatTaskType(task.taskType)}
              </span>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${priorityTone(task.priority)}`}>
                {task.priority}
              </span>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</summary>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Metadata</p>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                    {JSON.stringify(task.metadata, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                  <pre className="mt-1 max-h-48 whitespace-pre-wrap overflow-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                    {task.notes || 'No notes yet.'}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        </div>
      </td>
      <td className="max-w-xs px-4 py-4 align-top">
        <p className="font-semibold text-foreground">{task.plan?.title ?? 'Unknown plan'}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{task.planId}</p>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>Status {task.plan?.status ?? 'unknown'}</p>
          <p>Neighborhood {task.plan?.neighborhood ?? 'not set'}</p>
          <p>Guests {task.plan?.guestCount ?? 'not set'}</p>
          <p>Date {task.plan?.dateWindowStart ? formatDate(task.plan.dateWindowStart) : 'not set'}</p>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(task.status)}`}>
          {task.status}
        </span>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>Due {formatDate(task.dueAt)}</p>
          <p>Created {formatDate(task.createdAt)}</p>
          <p>Updated {formatDate(task.updatedAt)}</p>
        </div>
      </td>
      <td className="min-w-[250px] px-4 py-4 align-top">
        <p className="font-semibold text-foreground">{task.assignee?.email ?? 'Unassigned'}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{task.assignedTo ?? 'No user id'}</p>
        <Input
          value={assigneeValue}
          onChange={(event) => onAssigneeChange(event.target.value)}
          placeholder="Assignee user id"
          className="mt-3"
          disabled={!canAssign || busy}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAssign || busy}
            onClick={() => onMutate(task, { action: 'assign', assignedTo: currentAdmin.id }, 'Assigned task.')}
          >
            <UserPlus className="mr-1 h-4 w-4" />
            Me
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAssign || busy || assigneeValue.trim().length === 0}
            onClick={() => onMutate(task, { action: 'assign', assignedTo: assigneeValue.trim() }, 'Assigned task.')}
          >
            Assign
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAssign || busy || !task.assignedTo}
            onClick={() => onMutate(task, { action: 'assign', assignedTo: null }, 'Cleared assignment.')}
          >
            Clear
          </Button>
        </div>
      </td>
      <td className="min-w-[320px] px-4 py-4 align-top">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Operator outcome
          <select
            value={completionOutcome}
            onChange={(event) => onOutcomeChange(event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm normal-case tracking-normal text-foreground"
            disabled={busy || !canComplete}
          >
            {isVenueHold ? (
              <>
                <option value="" disabled>Select an outcome</option>
                <option value="hold_confirmed">Hold confirmed</option>
                <option value="venue_unavailable">Venue unavailable</option>
              </>
            ) : (
              <option value="completed">Completed</option>
            )}
          </select>
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Host-visible update
          <Textarea
            value={hostMessageValue}
            onChange={(event) => onHostMessageChange(event.target.value)}
            placeholder="Optional. 3rdPlace will use a safe default if blank."
            className="mt-1 min-h-20 normal-case tracking-normal text-foreground"
            disabled={busy || (!canComplete && !canCancel)}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Internal note
          <Textarea
            value={noteValue}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Internal note"
            className="mt-1 min-h-20 normal-case tracking-normal text-foreground"
            disabled={busy}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canStart || busy}
            onClick={() => onMutate(task, { action: 'start' }, 'Task started.')}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
            Start
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canSubmitCompletion || busy}
            onClick={() => onMutate(task, {
              action: 'complete',
              note: note || null,
              hostMessage: hostMessageValue.trim() || null,
              outcomePayload: {
                outcome: completionOutcome,
                summary: hostMessageValue.trim() || null,
              },
            }, 'Task completed and the host-visible state was updated.')}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" />
            Complete
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCancel || busy}
            onClick={() => onMutate(task, {
              action: 'cancel',
              note: note || null,
              hostMessage: hostMessageValue.trim() || null,
            }, 'Task cancelled and the host-visible state was updated.')}
          >
            <Ban className="mr-1 h-4 w-4" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || note.length === 0}
            onClick={() => onMutate(task, { action: 'append_note', note }, 'Note appended.')}
          >
            Note
          </Button>
        </div>
      </td>
    </tr>
  )
}
