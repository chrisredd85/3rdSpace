'use client'

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import type { Event, EventTask } from '@/lib/types'

interface EventChecklistStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

type TaskPriority = EventTask['priority']

const DEFAULT_TASKS = [
  'Send invitations',
  'Confirm venue booking',
  'Confirm vendor bookings',
]

const selectCls = `
  flex h-11 w-full rounded-xl border border-border bg-card/40
  px-4 py-3 text-base text-foreground min-h-[44px]
  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
  transition-smooth hover:border-border/80 hover:bg-card
  appearance-none
  bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23a1a1aa%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')]
  bg-no-repeat bg-right-4 bg-[length:18px]
`

const priorityStyles: Record<TaskPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-primary/15 text-primary',
  high: 'bg-destructive/10 text-destructive',
}

function formatDueDate(dueDate: string) {
  return new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function EventChecklistStep({ event, onNext }: EventChecklistStepProps) {
  const { addToast } = useToast()
  const [tasks, setTasks] = useState<EventTask[]>([])
  const [newTask, setNewTask] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [isAdding, setIsAdding] = useState(false)
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!event.id || event.id === 'new') return

    let isCancelled = false

    async function createTask(text: string) {
      const response = await fetch(`/api/builder/events/${event.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, priority: 'medium' }),
      })
      const result = await response.json() as { task?: EventTask; error?: string }

      if (!response.ok || !result.task) {
        throw new Error(result.error || 'Failed to create task')
      }

      return result.task
    }

    async function fetchTasks() {
      try {
        const response = await fetch(`/api/builder/events/${event.id}/tasks`, {
          credentials: 'include',
        })
        const result = await response.json() as { tasks?: EventTask[]; error?: string }

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load tasks')
        }

        const fetchedTasks = result.tasks || []
        if (fetchedTasks.length > 0) {
          if (!isCancelled) setTasks(fetchedTasks)
          return
        }

        const seededTasks = await Promise.all(DEFAULT_TASKS.map((taskText) => createTask(taskText)))
        if (!isCancelled) setTasks(seededTasks)
      } catch (error) {
        if (!isCancelled) {
          addToast({
            title: 'Error',
            description: error instanceof Error ? error.message : 'Failed to load tasks',
            variant: 'destructive',
          })
        }
      }
    }

    fetchTasks()

    return () => {
      isCancelled = true
    }
  }, [event.id, addToast])

  const handleAddTask = async () => {
    if (!newTask.trim()) return

    setIsAdding(true)
    try {
      const response = await fetch(`/api/builder/events/${event.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: newTask,
          due_date: dueDate || null,
          priority,
        }),
      })
      const result = await response.json() as { task?: EventTask; error?: string }

      if (!response.ok || !result.task) {
        throw new Error(result.error || 'Failed to add task')
      }

      setTasks((currentTasks) => [...currentTasks, result.task as EventTask])
      setNewTask('')
      setDueDate('')
      setPriority('medium')
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add task',
        variant: 'destructive',
      })
    } finally {
      setIsAdding(false)
    }
  }

  const handleToggleTask = async (task: EventTask) => {
    setMutatingTaskId(task.id)
    try {
      const response = await fetch(`/api/builder/events/${event.id}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskId: task.id, completed: !task.completed }),
      })
      const result = await response.json() as { task?: EventTask; error?: string }

      if (!response.ok || !result.task) {
        throw new Error(result.error || 'Failed to update task')
      }

      setTasks((currentTasks) => currentTasks.map((currentTask) => (
        currentTask.id === task.id ? result.task as EventTask : currentTask
      )))
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update task',
        variant: 'destructive',
      })
    } finally {
      setMutatingTaskId(null)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    setMutatingTaskId(taskId)
    try {
      const response = await fetch(`/api/builder/events/${event.id}/tasks?taskId=${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      const result = await response.json() as { error?: string }

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete task')
      }

      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId))
    } catch (error) {
      addToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete task',
        variant: 'destructive',
      })
    } finally {
      setMutatingTaskId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-[1fr_160px_150px_auto]">
        <Input
          placeholder="Add a task..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTask() } }}
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Task due date"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className={selectCls}
          aria-label="Task priority"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <Button variant="hero" onClick={handleAddTask} disabled={isAdding || !newTask.trim()}>
          <Plus className="h-4 w-4 mr-1" /> {isAdding ? 'Adding...' : 'Add'}
        </Button>
      </div>

      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 rounded-xl border border-border bg-card/20 p-3 transition-smooth hover:bg-card/40"
          >
            <input
              type="checkbox"
              checked={task.completed}
              onChange={() => handleToggleTask(task)}
              disabled={mutatingTaskId === task.id}
              className="h-4 w-4 accent-primary"
            />
            <div className="flex flex-1 flex-col gap-1">
              <span className={cn('text-sm', task.completed ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {task.text}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {task.due_date && (
                  <span className="text-xs text-muted-foreground">Due {formatDueDate(task.due_date)}</span>
                )}
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', priorityStyles[task.priority])}>
                  {task.priority}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteTask(task.id)}
              disabled={mutatingTaskId === task.id}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button variant="hero" onClick={onNext}>Next: Documents</Button>
      </div>
    </div>
  )
}
