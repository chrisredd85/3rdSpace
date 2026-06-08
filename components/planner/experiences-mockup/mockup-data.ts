export type BannerState = 'urgent' | 'calm'
export type StatusTone = 'action' | 'settled' | 'drafting' | 'awaiting' | 'track'
export type SectionKey = 'plan' | 'bookings' | 'money' | 'guests'
export type BookingKey = 'venue' | 'food' | 'photo' | 'checkin'

export interface MockupEventCard {
  id: string
  dateLabel: string
  metro: string
  title: string
  timingLabel: string
  attentionLabel: string
  tone: StatusTone
  isFullyModeled: boolean
}

export interface DrilldownSection {
  key: SectionKey
  number: string
  title: string
  summary: string
  status: string
  tone: StatusTone
}

export interface BookingItem {
  key: BookingKey
  title: string
  partner: string
  detail: string
  costCents: number | null
  costLabel?: string
  status: string
  tone: StatusTone
}

export interface MoneyLine {
  label: string
  amountCents: number
  detail?: string
  kind: 'income' | 'cost' | 'fee' | 'total' | 'profit'
}

export const mockupEvents: MockupEventCard[] = [
  {
    id: 'founder-dinner',
    dateLabel: 'Jun 28',
    metro: 'SF',
    title: 'Founder Dinner',
    timingLabel: 'T-20 days',
    attentionLabel: '1 for you',
    tone: 'action',
    isFullyModeled: true,
  },
  {
    id: 'ai-builders-mixer',
    dateLabel: 'Jul 17',
    metro: 'Oakland',
    title: 'AI Builders Mixer',
    timingLabel: 'T-39 days',
    attentionLabel: '2 for you',
    tone: 'drafting',
    isFullyModeled: false,
  },
  {
    id: 'hiring-panel',
    dateLabel: 'May 22',
    metro: 'SF',
    title: "Panel: Hiring in '26",
    timingLabel: 'T+17 days',
    attentionLabel: 'settled',
    tone: 'settled',
    isFullyModeled: false,
  },
  {
    id: 'operator-salon',
    dateLabel: 'Sep 11',
    metro: 'Peninsula',
    title: 'Q3 Operator Salon',
    timingLabel: 'T-95 days',
    attentionLabel: 'calm',
    tone: 'awaiting',
    isFullyModeled: false,
  },
]

export const founderDinner = {
  title: 'Founder Dinner',
  dateLabel: 'June 28, 2026',
  description: 'An evening for 72 operators in the Mission.',
  chips: ['SF', '72 guests', 'Ticketed via Posh'],
  historyLabel: 'from your last 3 Founder Dinners',
  urgentBanner: {
    eyebrow: 'One approval needs you.',
    title: 'Confirm the venue hold for The Pearl SF before Jun 10.',
    body: 'The Pearl is holding the room until then. Deposit is $1,650 of $5,500 total.',
    primaryCta: 'Review approval',
    secondaryCta: 'Use last event terms',
  },
  calmBanner: {
    eyebrow: 'Nothing waiting on you right now.',
    title: 'The agent is watching the open bookings and money risk.',
    body: 'Food & beverage is still in draft. You will be asked before any terms, deposits, or messages go out.',
    primaryCta: 'View bookings',
    secondaryCta: 'Check profit',
  },
}

export const drilldownSections: DrilldownSection[] = [
  {
    key: 'plan',
    number: '01',
    title: 'Plan',
    summary: 'Brief locked. Run-of-show approved.',
    status: 'Settled',
    tone: 'settled',
  },
  {
    key: 'bookings',
    number: '02',
    title: 'Bookings',
    summary: 'Venue hold needs you. Food in draft. Photo signed.',
    status: 'Action required',
    tone: 'action',
  },
  {
    key: 'money',
    number: '03',
    title: 'Money',
    summary: '$3,240 projected profit. Food budget is at the high end.',
    status: 'On track',
    tone: 'track',
  },
  {
    key: 'guests',
    number: '04',
    title: 'Guests',
    summary: '58 confirmed of 72. No action needed.',
    status: 'On track',
    tone: 'track',
  },
]

export const bookingItems: BookingItem[] = [
  {
    key: 'venue',
    title: 'Venue',
    partner: 'The Pearl SF',
    detail: 'Hold expires Jun 10',
    costCents: 550000,
    status: 'Approval required',
    tone: 'action',
  },
  {
    key: 'food',
    title: 'Food & Beverage',
    partner: 'Souvla catering + house bar',
    detail: 'Operator drafting menu',
    costCents: 320000,
    costLabel: 'est.',
    status: 'Drafting',
    tone: 'drafting',
  },
  {
    key: 'photo',
    title: 'Photo',
    partner: 'Lena Park',
    detail: 'Contract signed Thu',
    costCents: 85000,
    status: 'Settled',
    tone: 'settled',
  },
  {
    key: 'checkin',
    title: 'Check-in',
    partner: 'House staff (2)',
    detail: 'Confirms 7 days out',
    costCents: null,
    status: 'Awaiting',
    tone: 'awaiting',
  },
]

export const venueDetail = {
  title: 'The Pearl SF -- Venue hold',
  address: '1010 Florida St, San Francisco',
  offer: 'Sunday Jun 28, 6 PM - 10:30 PM, Main room, capacity 80',
  holdDeadline: 'Wednesday Jun 10, expires in 2 days',
  deposit: '$1,650 of $5,500 total. Refundable until Jun 21.',
  includedTerms: [
    'Set up and breakdown access from 4 PM',
    'House sound system included',
    'No outside alcohol; bar minimum $400',
    'Same terms as your last 2 Founder Dinners at The Pearl',
  ],
  reuseSource: 'Founder Dinner, May 16',
}

export const photoDetail = {
  title: 'Lena Park -- Photographer',
  relationship: 'This is your 4th event together. Reliability: 100% on-time.',
  contract: 'Contract signed Thursday. $850 total. 50% deposit paid.',
}

export const moneyLines: MoneyLine[] = [
  {
    label: 'Ticket revenue target',
    amountCents: 720000,
    detail: '72 x $100',
    kind: 'income',
  },
  {
    label: 'Partner commitments',
    amountCents: 582000,
    detail: 'confirmed sponsor table + bar guarantee',
    kind: 'income',
  },
  {
    label: 'Venue',
    amountCents: -550000,
    detail: 'committed',
    kind: 'cost',
  },
  {
    label: 'Food & beverage',
    amountCents: -320000,
    detail: 'est., not committed',
    kind: 'cost',
  },
  {
    label: 'Photo',
    amountCents: -85000,
    detail: 'committed',
    kind: 'cost',
  },
  {
    label: 'Check-in staff',
    amountCents: -20000,
    detail: 'est.',
    kind: 'cost',
  },
  {
    label: '3rdPlace per-event fee',
    amountCents: -3000,
    detail: 'settled',
    kind: 'fee',
  },
]

export const moneySummary = {
  projectedProfitCents: 324000,
  confidenceLabel: '~80% confidence',
  totalIncomeCents: 1302000,
  totalCostCents: 978000,
  breakEvenTickets: 40,
  marginLabel: '25%',
  watchTitle: 'One thing the agent is watching',
  watchBody: 'Food budget is at the high end of typical for this size. If the catering quote comes in above $3,500, projected profit drops below $2,940.',
  watchCta: 'Ask Souvla to confirm',
}

export const guestSummary = {
  confirmed: 58,
  target: 72,
  remaining: 14,
  velocity: ['+3', '+2', '+4', '+3', '+5'],
  people: [
    'Jenny Park - Founder, Ovaltine',
    'Marcus Lee - Partner, North Side Capital',
    'Priya Mehta - CTO, Latch',
    'Adesh Iyer - Founder, Field',
    'Lena Park - Photographer (comp)',
    'Nora Chen - Founder, Common Room',
    'Devin Ruiz - Operator, Pulse',
    'Samira Khan - Investor, Seven Hills',
    'Taylor Kim - Chief of Staff, Modal',
    'Eli Foster - Founder, Rally',
  ],
  reminders: [
    {
      label: '3 days before',
      copy: "Don't forget -- Friday at The Pearl.",
    },
    {
      label: 'Day-of',
      copy: 'Doors at 6, dinner at 7.',
    },
  ],
  checkin: 'House staff confirms on Jun 21. No action needed yet.',
}

export function formatCents(cents: number) {
  const absValue = Math.abs(cents) / 100
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(absValue)

  return cents < 0 ? `-${formatted}` : formatted
}
