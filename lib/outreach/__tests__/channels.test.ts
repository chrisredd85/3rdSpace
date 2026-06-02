import {
  buildInstagramDmDeepLink,
  ensureSmsOptOutCopy,
  isSmsOptOutKeyword,
  selectOutreachChannel,
} from '@/lib/outreach/channels'
import { ensureVoiceDisclosure } from '@/lib/outreach/voice'

jest.mock('server-only', () => ({}))

describe('multi-channel outreach helpers', () => {
  it('prefers an explicit venue contact channel when creator has it enabled', () => {
    expect(selectOutreachChannel({
      contactProfile: {
        preferred_channel: 'sms',
        phone_e164: '+14155550100',
      },
      target: {
        email: 'events@example.com',
        phone: '+14155550100',
      },
      creatorEnabledChannels: {
        sms: true,
      },
    })).toBe('sms')
  })

  it('falls back to email when SMS is unavailable or disabled', () => {
    expect(selectOutreachChannel({
      contactProfile: {
        preferred_channel: 'sms',
        phone_e164: '+14155550100',
      },
      target: {
        email: 'events@example.com',
        phone: '+14155550100',
      },
      creatorEnabledChannels: {
        sms: false,
      },
    })).toBe('email')
  })

  it('builds Instagram deep links and keeps opt-out language on SMS', () => {
    expect(buildInstagramDmDeepLink({
      handle: '@missionhall',
      message: 'Hi, is Sep 12 available?',
    })).toBe('instagram://direct/new?recipient=%40missionhall&text=Hi%2C+is+Sep+12+available%3F')

    expect(ensureSmsOptOutCopy('Is Sep 12 available?')).toBe('Is Sep 12 available? Reply STOP to opt out.')
    expect(isSmsOptOutKeyword(' unsubscribe ')).toBe(true)
  })

  it('forces voice scripts to disclose automated agency', () => {
    expect(ensureVoiceDisclosure('Checking availability for Sep 12.')).toMatch(/automated assistant calling on behalf/i)
  })
})
