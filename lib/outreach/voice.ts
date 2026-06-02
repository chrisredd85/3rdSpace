import 'server-only'

import type { Json, OutreachMessage, OutreachThread } from '@/lib/types'

type VoiceDb = { from(table: string): any }

export type VoiceCallResult = {
  callId: string
  provider: 'bland'
  raw: Json
}

export function ensureVoiceDisclosure(script: string) {
  const normalized = script.toLowerCase()
  if (
    normalized.includes('calling on behalf of') &&
    (normalized.includes('automated') || normalized.includes('ai') || normalized.includes('virtual assistant'))
  ) {
    return script.trim()
  }

  return [
    "Hi, this is an automated assistant calling on behalf of the event organizer.",
    script.trim(),
  ].join(' ')
}

export async function placeVoiceAvailabilityCall(input: {
  db: VoiceDb
  thread: OutreachThread
  draft: OutreachMessage
}) {
  if (input.thread.channel !== 'voice') {
    throw new Error('Voice call can only be placed for voice outreach threads')
  }
  if (!input.thread.target_phone) {
    throw new Error('Voice outreach requires a target phone number')
  }

  const script = ensureVoiceDisclosure(input.draft.body_text)
  const apiKey = process.env.BLAND_API_KEY
  if (!apiKey) {
    throw new Error('BLAND_API_KEY is required before placing voice calls')
  }

  const response = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phone_number: input.thread.target_phone,
      task: script,
      voice: process.env.BLAND_VOICE_ID || 'maya',
      max_duration: 3,
      record: false,
      metadata: {
        thread_id: input.thread.id,
        plan_id: input.thread.plan_id,
      },
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(readProviderError(payload) ?? 'Voice provider rejected the call')
  }

  const callId = readString(payload.call_id) ?? readString(payload.callId) ?? readString(payload.id)
  if (!callId) throw new Error('Voice provider response did not include a call id')

  await input.db
    .from('outreach_compliance_events')
    .insert({
      thread_id: input.thread.id,
      message_id: input.draft.id,
      user_id: input.thread.user_id,
      channel: 'voice',
      event_type: 'voice_ai_disclosure',
      severity: 'info',
      metadata: { disclosure_script: script } as Json,
    })

  return {
    callId,
    provider: 'bland' as const,
    raw: payload as Json,
  }
}

function readProviderError(payload: unknown) {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  return readString(record?.error) ?? readString(record?.message)
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
