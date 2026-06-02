export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logInboundChannelReply } from '@/lib/outreach/inbound'
import { createServiceRoleClient } from '@/lib/supabase/server'

const THREAD_SELECT = `
  id,
  plan_id,
  user_id,
  target_type,
  target_id,
  target_name,
  target_email,
  target_phone,
  target_instagram_handle,
  channel,
  target_source,
  discovery_venue_id,
  channel_strategy,
  state,
  source_agent_action_id,
  needs_attention,
  follow_up_count,
  last_event_at,
  last_outbound_at,
  last_inbound_at,
  next_action_at,
  created_at,
  updated_at
`

export async function POST(request: NextRequest) {
  if (!isAuthorizedWebhook(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData()
  const from = String(form.get('From') ?? '')
  const to = String(form.get('To') ?? '')
  const body = String(form.get('Body') ?? '')
  const messageSid = String(form.get('MessageSid') ?? form.get('SmsMessageSid') ?? '')

  if (!from || !body) {
    return NextResponse.json({ error: 'Missing Twilio SMS payload' }, { status: 400 })
  }

  const admin = createServiceRoleClient() as any
  const { data: thread, error } = await admin
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('channel', 'sms')
    .eq('target_phone', from)
    .in('state', ['awaiting_reply', 'in_negotiation', 'stale'])
    .order('last_outbound_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[twilio.inbound-sms] Thread lookup failed', error)
    return NextResponse.json({ error: 'Unable to route inbound SMS' }, { status: 500 })
  }
  if (!thread) return NextResponse.json({ received: true, routed: false })

  await logInboundChannelReply({
    db: admin,
    thread,
    channel: 'sms',
    bodyText: body,
    channelExternalId: messageSid || null,
    providerMetadata: { provider: 'twilio', from, to },
  })

  return NextResponse.json({ received: true, routed: true })
}

function isAuthorizedWebhook(request: NextRequest) {
  const secret = process.env.TWILIO_INBOUND_WEBHOOK_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return request.headers.get('x-webhook-secret') === secret || request.nextUrl.searchParams.get('secret') === secret
}
