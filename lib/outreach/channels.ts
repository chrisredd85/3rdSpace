import type { OutreachChannel } from '@/lib/types'

export type ChannelContactProfile = {
  preferred_channel?: OutreachChannel | null
  email?: string | null
  phone_e164?: string | null
  instagram_handle?: string | null
  sms_opted_out_at?: string | null
  voice_allowed?: boolean | null
}

export type ChannelTarget = {
  email?: string | null
  phone?: string | null
  instagramHandle?: string | null
}

export type CreatorEnabledChannels = Partial<Record<OutreachChannel, boolean>>

const CHANNEL_ORDER: OutreachChannel[] = ['email', 'sms', 'instagram', 'voice']
const STOP_PATTERN = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i

export function selectOutreachChannel(input: {
  contactProfile?: ChannelContactProfile | null
  target: ChannelTarget
  creatorEnabledChannels?: CreatorEnabledChannels
  requestedChannel?: OutreachChannel | null
}): OutreachChannel {
  const enabled = {
    email: true,
    instagram: true,
    sms: false,
    voice: false,
    ...(input.creatorEnabledChannels ?? {}),
  }
  const viable = new Set(
    CHANNEL_ORDER.filter((channel) => enabled[channel] && hasContactForChannel(channel, input.target, input.contactProfile))
  )

  if (input.requestedChannel && viable.has(input.requestedChannel)) return input.requestedChannel
  const preferred = input.contactProfile?.preferred_channel
  if (preferred && viable.has(preferred)) return preferred

  return CHANNEL_ORDER.find((channel) => viable.has(channel)) ?? 'email'
}

export function hasContactForChannel(
  channel: OutreachChannel,
  target: ChannelTarget,
  contactProfile?: ChannelContactProfile | null
) {
  if (channel === 'email') return Boolean(target.email ?? contactProfile?.email)
  if (channel === 'instagram') return Boolean(normalizeInstagramHandle(target.instagramHandle ?? contactProfile?.instagram_handle))
  if (channel === 'sms') {
    return Boolean(
      !contactProfile?.sms_opted_out_at &&
      normalizeE164(target.phone ?? contactProfile?.phone_e164)
    )
  }
  if (channel === 'voice') {
    return Boolean(
      (contactProfile?.voice_allowed ?? true) &&
      normalizeE164(target.phone ?? contactProfile?.phone_e164)
    )
  }
  return false
}

export function buildInstagramDmDeepLink(input: {
  handle: string
  message: string
}) {
  const handle = normalizeInstagramHandle(input.handle)
  if (!handle) throw new Error('Instagram handle is required')
  const params = new URLSearchParams({
    recipient: `@${handle}`,
    text: input.message,
  })
  return `instagram://direct/new?${params.toString()}`
}

export function ensureSmsOptOutCopy(message: string) {
  const trimmed = message.trim()
  if (/reply\s+stop\s+to\s+opt\s+out/i.test(trimmed)) return trimmed
  return `${trimmed} Reply STOP to opt out.`
}

export function isSmsOptOutKeyword(message: string) {
  return STOP_PATTERN.test(message)
}

export function normalizeE164(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return /^\+[1-9]\d{7,14}$/.test(trimmed) ? trimmed : null
}

export function normalizeInstagramHandle(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^@/, '')
  if (!trimmed) return null
  return /^[a-zA-Z0-9._]{1,30}$/.test(trimmed) ? trimmed : null
}
