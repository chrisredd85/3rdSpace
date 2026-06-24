export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

type SignupRole = 'community_builder' | 'venue_owner' | 'vendor'
type SignupEventName = 'signup_step_viewed' | 'signup_step_completed'

const roles = new Set<SignupRole>(['community_builder', 'venue_owner', 'vendor'])
const eventNames = new Set<SignupEventName>(['signup_step_viewed', 'signup_step_completed'])
const methods = new Set(['email', 'google'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const role = readString(body.role)
    const eventName = readString(body.event_name)
    const step = readPositiveInteger(body.step)
    const totalSteps = readPositiveInteger(body.total_steps)
    const method = readString(body.method)
    const anonymousId = readString(body.anonymous_id)
    const metadata = readJsonRecord(body.metadata)

    if (!role || !roles.has(role as SignupRole) || !eventName || !eventNames.has(eventName as SignupEventName)) {
      return NextResponse.json({ error: 'Invalid signup event' }, { status: 400 })
    }

    const admin = createServiceRoleClient()
    const { error } = await (admin as any)
      .from('signup_funnel_events')
      .insert({
        role,
        event_name: eventName,
        step,
        total_steps: totalSteps,
        method: method && methods.has(method) ? method : null,
        anonymous_id: anonymousId?.slice(0, 128) ?? null,
        metadata,
      } as never)

    if (error) {
      console.warn('[signup.events] Failed to record signup funnel event', error)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.warn('[signup.events] Ignoring malformed signup event', error)
    return NextResponse.json({ ok: true })
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function readJsonRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
