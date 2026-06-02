import 'server-only'

import { ensureSmsOptOutCopy, normalizeE164 } from '@/lib/outreach/channels'
import type { Json, OutreachMessage, OutreachThread } from '@/lib/types'

type SmsDb = { from(table: string): any }

export type TwilioSmsResult = {
  messageSid: string
  status: string | null
  raw: Json
}

export async function sendTwilioSms(input: {
  db: SmsDb
  thread: OutreachThread
  draft: OutreachMessage
  userId: string
}) {
  if (input.thread.channel !== 'sms') {
    throw new Error('SMS send can only be used for SMS outreach threads')
  }

  const to = normalizeE164(input.thread.target_phone)
  if (!to) throw new Error('SMS outreach requires a public business phone number in E.164 format')

  const fromNumber = await loadVerifiedCreatorNumber(input.db, input.userId)
  if (!fromNumber) {
    throw new Error('Verify a creator phone number before sending SMS outreach')
  }
  if (fromNumber.a2p_registration_status !== 'approved' && process.env.NODE_ENV === 'production') {
    await logSmsBlocked(input.db, input.thread, input.draft, 'a2p_not_approved')
    throw new Error('A2P registration must be approved before production SMS traffic')
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required before sending SMS')
  }

  const body = ensureSmsOptOutCopy(input.draft.body_text)
  const form = new URLSearchParams({
    To: to,
    Body: body,
  })
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID)
  } else {
    form.set('From', fromNumber.e164_number)
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(readProviderError(payload) ?? 'Twilio rejected the SMS send')
  }

  const messageSid = readString(payload.sid)
  if (!messageSid) throw new Error('Twilio response did not include a MessageSid')

  return {
    messageSid,
    status: readString(payload.status),
    raw: payload as Json,
  }
}

async function loadVerifiedCreatorNumber(db: SmsDb, userId: string) {
  const { data, error } = await db
    .from('creator_phone_numbers')
    .select('id, user_id, e164_number, verified_at, twilio_sid, a2p_registration_status')
    .eq('user_id', userId)
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load creator phone number: ${error.message}`)
  return data as {
    id: string
    e164_number: string
    a2p_registration_status: string
  } | null
}

async function logSmsBlocked(
  db: SmsDb,
  thread: OutreachThread,
  draft: OutreachMessage,
  reason: string
) {
  await db
    .from('outreach_compliance_events')
    .insert({
      thread_id: thread.id,
      message_id: draft.id,
      user_id: thread.user_id,
      channel: 'sms',
      event_type: 'sms_send_blocked',
      severity: 'warning',
      metadata: { reason } as Json,
    })
}

function readProviderError(payload: unknown) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  return readString(record?.message) ?? readString(record?.error)
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
