export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { sendDataDeletionRequestedEmail } from '@/lib/privacy/executeDataDeletion'
import { createClient } from '@/lib/supabase/server'

const requestSchema = z.object({
  reason: z.string().max(2000).optional().nullable(),
})

function coolingOffDate() {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString()
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid deletion request' }, { status: 400 })
  }

  const { data: existing, error: existingError } = await (supabase as any)
    .from('data_deletion_requests')
    .select('id,status,cooling_off_ends_at')
    .eq('user_id', user.id)
    .in('status', ['requested', 'in_review', 'approved'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  if (existing) {
    return NextResponse.json({ request: existing, alreadyPending: true })
  }

  const coolingOffEndsAt = coolingOffDate()
  const { data, error } = await (supabase as any)
    .from('data_deletion_requests')
    .insert({
      user_id: user.id,
      email: user.email,
      reason: parsed.data.reason || null,
      cooling_off_ends_at: coolingOffEndsAt,
    })
    .select('id,status,cooling_off_ends_at,requested_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await sendDataDeletionRequestedEmail({
    to: user.email,
    coolingOffEndsAt,
  }).catch((emailError) => {
    console.warn('[privacy.data_deletion] Confirmation email failed', emailError)
  })

  return NextResponse.json({ request: data })
}

export async function PATCH() {
  const supabase = createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await (supabase as any)
    .from('data_deletion_requests')
    .update({ status: 'canceled' })
    .eq('user_id', user.id)
    .eq('status', 'requested')
    .select('id,status')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'No cancellable deletion request found' }, { status: 404 })
  }

  return NextResponse.json({ request: data })
}
