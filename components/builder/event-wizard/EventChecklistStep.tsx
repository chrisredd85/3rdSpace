'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Event } from '@/lib/types'

interface EventChecklistStepProps {
  event: Event
  onNext: () => void
  onPrevious: () => void
  onSave: () => void
  currentStep: number
  totalSteps: number
}

export function EventChecklistStep({
  onNext,
}: EventChecklistStepProps) {
  const [tasks, setTasks] = useState<Array<{ id: string; text: string; completed: boolean }>>([
    { id: '1', text: 'Send invitations', completed: false },
    { id: '2', text: 'Confirm venue booking', completed: false },
    { id: '3', text: 'Confirm vendor bookings', completed: false },
  ])
  const [newTask, setNewTask] = useState('')

  const handleAddTask = () => {
    if (!newTask.trim()) return
    setTasks([
      ...tasks,
      { id: Date.now().toString(), text: newTask, completed: false },
    ])
    setNewTask('')
  }

  const handleToggleTask = (id: string) => {
    setTasks(tasks.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)))
  }

  const handleRemoveTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Step 6: Checklist</CardTitle>
          <CardDescription>
            Create a checklist of tasks to complete before your event
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Add a task..."
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddTask()}
            />
            <Button onClick={handleAddTask}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg"
              >
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => handleToggleTask(task.id)}
                  className="h-4 w-4 text-forest-500"
                />
                <span
                  className={`flex-1 ${
                    task.completed ? 'line-through text-gray-400' : 'text-gray-900'
                  }`}
                >
                  {task.text}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveTask(task.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4">
            <Button onClick={onNext}>Next: Documents</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
