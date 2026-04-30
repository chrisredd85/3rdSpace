import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import type { Database, EventTeamMember } from '@/lib/types'

interface RouteContext {
  params: {
    id: string
  }
}

type TeamRole = EventTeamMember['role']
type EventTeamMemberInsert = Database['public']['Tables']['event_team_members']['Insert']
type BuilderAuth =
  | { response: NextResponse }
  | { supabase: ReturnType<typeof createClient>; builderProfileId: string }

const TEAM_ROLES: TeamRole[] = ['organizer', 'coordinator', 'vendor_contact']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && TEAM_ROLES.includes(value as TeamRole)
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
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
      .from('event_team_members')
      .select('*')
      .eq('event_id', params.id)
      .order('invited_at', { ascending: true })

    if (error) {
      console.error('Error fetching event team:', error)
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 })
    }

    return NextResponse.json({ members: data || [] })
  } catch (error) {
    console.error('Get event team error:', error)
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

    const email = normalizeEmail(body.email)
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }

    if (!isTeamRole(body.role)) {
      return NextResponse.json({ error: 'A valid role is required' }, { status: 400 })
    }

    const payload: EventTeamMemberInsert = {
      event_id: params.id,
      email,
      role: body.role,
    }

    const { data, error } = await auth.supabase
      .from('event_team_members')
      .insert(payload as never)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This email has already been invited' }, { status: 409 })
      }

      console.error('Error creating event team member:', error)
      return NextResponse.json({ error: 'Failed to invite team member' }, { status: 500 })
    }

    return NextResponse.json({ member: data }, { status: 201 })
  } catch (error) {
    console.error('Create event team member error:', error)
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
    const memberId = searchParams.get('memberId')
    if (!memberId) {
      return NextResponse.json({ error: 'memberId is required' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('event_team_members')
      .delete()
      .eq('id', memberId)
      .eq('event_id', params.id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('Error deleting event team member:', error)
      return NextResponse.json({ error: 'Failed to remove team member' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete event team member error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
