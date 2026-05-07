import { z } from 'zod'

const CLOSED_TASK_STATUSES = new Set(['complete', 'completed', 'done', 'cancelled', 'canceled'])

export const eventTaskRowSchema = z.object({
  id: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  due_date: z.string().trim().min(1).nullable(),
  status: z.string().trim().min(1),
  assigned_to: z.string().trim().min(1).nullable(),
})

export type EventTaskRow = z.infer<typeof eventTaskRowSchema>

export function getOverdueTaskTitles(
  tasks: EventTaskRow[],
  currentDate: Date = new Date()
): string[] {
  const currentDay = toUtcDay(currentDate)

  return tasks
    .filter((task) => isTaskOverdue(task, currentDay))
    .map((task) => task.title)
}

export function isTaskOverdue(task: EventTaskRow, currentDate: Date = new Date()): boolean {
  if (!task.due_date || isClosedTaskStatus(task.status)) return false

  const dueDay = parseDueDate(task.due_date)
  if (!dueDay) return false

  return dueDay.getTime() < toUtcDay(currentDate).getTime()
}

function isClosedTaskStatus(status: string): boolean {
  return CLOSED_TASK_STATUSES.has(status.trim().toLowerCase())
}

function parseDueDate(dueDate: string): Date | null {
  const match = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, monthIndex, day))

  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}
