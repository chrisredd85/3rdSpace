export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import type { Database, EventTask } from '@/lib/types'

interface RouteContext {
  params: {
    id: string
  }
}

type TaskPriority = EventTask['priority']
type EventTaskInsert = Database['public']['Tables']['event_tasks']['Insert']
type EventTaskUpdate = Database['public']['Tables']['event_tasks']['Update']
type BuilderAuth =
  | { response: NextResponse }
  | { supabase: ReturnType<typeof createClient>; builderProfileId: string }

const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && TASK_PRIORITIES.includes(value as TaskPriority)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDueDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' ? value : undefined
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    }
  }

  const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
  if (builderProfileError || !builderProfileId) {
    return {
      response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }),
    }
  }

  return { supabase, builderProfileId }
}

async function verifyEventAccess(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  builderProfileId: string
) {
  const { data: event, error } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('builder_id', builderProfileId)
    .maybeSingle()

  if (error || !event) {
    return false
  }

  return true
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const hasAccess = await verifyEventAccess(auth.supabase, params.id, auth.builderProfileId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const { data, error } = await auth.supabase
      .from('event_tasks')
      .select('*')
      .eq('event_id', params.id)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching event tasks:', error)
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
    }

    return NextResponse.json({ tasks: data || [] })
  } catch (error) {
    console.error('Get event tasks error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const hasAccess = await verifyEventAccess(auth.supabase, params.id, auth.builderProfileId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const body: unknown = await request.json()
    if (!isRecord(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const text = normalizeText(body.text)
    if (!text) {
      return NextResponse.json({ error: 'Task text is required' }, { status: 400 })
    }

    const dueDate = normalizeDueDate(body.due_date)
    if (dueDate === undefined) {
      return NextResponse.json({ error: 'due_date must be a string or null' }, { status: 400 })
    }

    const priority = body.priority === undefined ? 'medium' : body.priority
    if (!isTaskPriority(priority)) {
      return NextResponse.json({ error: 'A valid priority is required' }, { status: 400 })
    }

    const payload: EventTaskInsert = {
      event_id: params.id,
      text,
      due_date: dueDate,
      priority,
    }

    const { data, error } = await auth.supabase
      .from('event_tasks')
      .insert(payload as never)
      .select('*')
      .single()

    if (error) {
      console.error('Error creating event task:', error)
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    return NextResponse.json({ task: data }, { status: 201 })
  } catch (error) {
    console.error('Create event task error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const hasAccess = await verifyEventAccess(auth.supabase, params.id, auth.builderProfileId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const body: unknown = await request.json()
    if (!isRecord(body) || typeof body.taskId !== 'string') {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const updates: EventTaskUpdate = {
      updated_at: new Date().toISOString(),
    }

    if (body.completed !== undefined) {
      if (typeof body.completed !== 'boolean') {
        return NextResponse.json({ error: 'completed must be a boolean' }, { status: 400 })
      }
      updates.completed = body.completed
    }

    if (body.text !== undefined) {
      const text = normalizeText(body.text)
      if (!text) {
        return NextResponse.json({ error: 'Task text is required' }, { status: 400 })
      }
      updates.text = text
    }

    if (body.due_date !== undefined) {
      const dueDate = normalizeDueDate(body.due_date)
      if (dueDate === undefined) {
        return NextResponse.json({ error: 'due_date must be a string or null' }, { status: 400 })
      }
      updates.due_date = dueDate
    }

    if (body.priority !== undefined) {
      if (!isTaskPriority(body.priority)) {
        return NextResponse.json({ error: 'A valid priority is required' }, { status: 400 })
      }
      updates.priority = body.priority
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No task updates provided' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('event_tasks')
      .update(updates as never)
      .eq('id', body.taskId)
      .eq('event_id', params.id)
      .select('*')
      .maybeSingle()

    if (error) {
      console.error('Error updating event task:', error)
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ task: data })
  } catch (error) {
    console.error('Update event task error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const hasAccess = await verifyEventAccess(auth.supabase, params.id, auth.builderProfileId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('event_tasks')
      .delete()
      .eq('id', taskId)
      .eq('event_id', params.id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Error deleting event task:', error)
      return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete event task error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
