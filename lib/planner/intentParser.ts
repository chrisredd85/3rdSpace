/**
 * Deterministic keyword and regex intent parser for the Agent Planner MVP.
 *
 * Purpose:
 * - Extract event planning fields from freeform user messages without calling an LLM.
 * - Normalize money to integer cents before API routes persist values.
 * - Return confidence scores so API/UI layers can distinguish exact matches from soft hints.
 *
 * Key behaviors:
 * - Event type is selected from supported keywords such as "hackathon", "concert", and "dinner".
 * - Guest count is only extracted when a number is near attendance words like "people", "builders", or "cap".
 * - Date parsing intentionally covers common MVP phrases and keeps ambiguous phrases as a date_hint.
 *
 * Examples:
 * parseEventIntent("Group dinner for 12 people, Friday night, Hayes Valley, under $800 total")
 * returns dinner, 12 guests, Hayes Valley, a Friday night hint, and an $800 budget in cents.
 */
import type { PlanIntent, PlanIntentEventType } from '@/lib/types'
import { classifyUnsupportedEventType } from '@/lib/planner/eventTaxonomy'

const DEFAULT_PLANNING_YEAR = 2026

const EVENT_TYPE_PATTERNS: Array<{
  event_type: PlanIntentEventType
  pattern: RegExp
  confidence: number
}> = [
  { event_type: 'hackathon', pattern: /\bhackathon(s)?\b/i, confidence: 0.98 },
  { event_type: 'concert', pattern: /\b(concert|show|performance|artist|book\s+[a-z0-9'-]+\s+for)\b/i, confidence: 0.9 },
  { event_type: 'retreat', pattern: /\b(corporate\s+retreat|retreat|offsite|off-site|team\s+offsite|team\s+off-site)\b/i, confidence: 0.96 },
  { event_type: 'dinner', pattern: /\b(dinner|supper|private\s+dining|group\s+dinner)\b/i, confidence: 0.96 },
  { event_type: 'mixer', pattern: /\b(mixer|networking|founder\s+meetup|happy\s+hour)\b/i, confidence: 0.94 },
  { event_type: 'conference', pattern: /\b(conference|summit|symposium|tech\s+week)\b/i, confidence: 0.82 },
  { event_type: 'popup', pattern: /\b(pop-?up|activation)\b/i, confidence: 0.92 },
  { event_type: 'party', pattern: /\b(party|celebration|reception)\b/i, confidence: 0.9 },
  { event_type: 'outing', pattern: /\b(outing|game|giants|warriors|group\s+tickets?)\b/i, confidence: 0.9 },
  { event_type: 'tennis', pattern: /\b(tennis|tennis\s+event|tennis\s+tournament|tennis\s+clinic|tennis\s+social)\b/i, confidence: 0.96 },
]

const NEIGHBORHOODS = [
  ['soma', 'SoMa'],
  ['so ma', 'SoMa'],
  ['mission', 'Mission'],
  ['embarcadero', 'Embarcadero'],
  ['hayes valley', 'Hayes Valley'],
  ['castro', 'Castro'],
  ['marina', 'Marina'],
  ['fidi', 'FiDi'],
  ['financial district', 'FiDi'],
  ['tenderloin', 'Tenderloin'],
  ['dogpatch', 'Dogpatch'],
  ['potrero', 'Potrero'],
  ['nob hill', 'Nob Hill'],
  ['north beach', 'North Beach'],
  ['downtown sf', 'Downtown SF'],
  ['downtown san francisco', 'Downtown SF'],
  ['san francisco', 'San Francisco'],
  ['sf', 'SF'],
  ['oakland', 'Oakland'],
  ['downtown oakland', 'Downtown Oakland'],
  ['berkeley', 'Berkeley'],
  ['napa', 'Napa'],
  ['napa valley', 'Napa Valley'],
] as const

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

/**
 * Parses a freeform event planning message into deterministic structured intent.
 *
 * The parser uses only keyword and regex matching. It intentionally avoids any
 * network calls, model calls, date libraries, randomness, or persistence so it
 * can be unit tested in isolation.
 *
 * @param message - User-authored planning request, such as "SF Tech Week mixer for 120 founders".
 * @returns Partial planning intent with confidence scores for every extracted field.
 */
export function parseEventIntent(message: string): Partial<PlanIntent> {
  const intent: Partial<PlanIntent> = { confidence: {} }
  const trimmed = message.trim()
  const lower = trimmed.toLowerCase()

  const eventType = extractEventType(trimmed)
  const taxonomyCandidate = classifyUnsupportedEventType(trimmed, eventType?.event_type)
  if (taxonomyCandidate) {
    intent.raw_event_type = taxonomyCandidate.raw_event_type
    intent.planning_archetype = taxonomyCandidate.planning_archetype
    intent.event_components = taxonomyCandidate.event_components
    intent.is_supported_event_type = false
    intent.taxonomy_candidate = taxonomyCandidate
    intent.confidence = {
      ...intent.confidence,
      raw_event_type: taxonomyCandidate.confidence === 'medium' ? 0.72 : 0.5,
      planning_archetype: taxonomyCandidate.confidence === 'medium' ? 0.68 : 0.45,
    }
  } else if (eventType) {
    intent.event_type = eventType.event_type
    intent.is_supported_event_type = true
    intent.confidence = { ...intent.confidence, event_type: eventType.confidence }
  }

  const eventComponents = extractCompoundEventComponents(trimmed)
  if (eventComponents.length > 0) {
    intent.event_components = eventComponents
  }

  const guestCount = extractGuestCount(trimmed)
  if (guestCount) {
    intent.guest_count = guestCount.value
    intent.confidence = { ...intent.confidence, guest_count: guestCount.confidence }
  }

  const budgetCap = extractBudgetCap(trimmed)
  if (budgetCap) {
    intent.budget_cap = budgetCap.value
    intent.confidence = { ...intent.confidence, budget_cap: budgetCap.confidence }
  }

  const areas = extractAreas(lower)
  if (areas.length > 0) {
    intent.neighborhood = areas[0]
    intent.areas = areas
    intent.confidence = {
      ...intent.confidence,
      neighborhood: 0.94,
      areas: areas.length > 1 ? 0.88 : 0.94,
    }
  }

  const dateWindow = extractDateWindow(trimmed)
  if (dateWindow) {
    intent.date_hint = dateWindow.hint
    if (dateWindow.start) intent.date_window_start = dateWindow.start
    if (dateWindow.end) intent.date_window_end = dateWindow.end
    intent.confidence = { ...intent.confidence, date_window: dateWindow.confidence }
  }

  const ticketed = extractTicketed(lower)
  if (ticketed) {
    intent.ticketed = ticketed.value
    intent.confidence = { ...intent.confidence, ticketed: ticketed.confidence }
  }

  const foodResponsibility = extractFoodResponsibility(lower)
  if (foodResponsibility) {
    intent.food_responsibility = foodResponsibility.value
    intent.confidence = { ...intent.confidence, food_responsibility: foodResponsibility.confidence }
  }

  const profitGoal = extractProfitGoal(trimmed)
  if (profitGoal) {
    intent.profit_goal = profitGoal.value
    intent.confidence = { ...intent.confidence, profit_goal: profitGoal.confidence }
  }

  return intent
}

function extractEventType(message: string) {
  return EVENT_TYPE_PATTERNS.find(({ pattern }) => pattern.test(message))
}

function extractGuestCount(message: string): { value: number; confidence: number } | null {
  const attendanceWords =
    '(?:builders?|people|guests?|attendees?|founders?|investors?|folks|members?|participants?|engineers?|executives?|creatives?|artists?|developers?|designers?|hackers?|students?|volunteers?|employees?|staff|speakers?|athletes?|runners?|players?|cap|capacity|pax|persons?)'
  const numberToken = '~?\\s*(\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k)?)'
  const hyphenatedPerson = message.match(/\b(\d[\d,]*)-person\b/i)
  if (hyphenatedPerson) {
    const value = parseHumanNumber(hyphenatedPerson[1])
    if (value) return { value, confidence: 0.92 }
  }
  const rangeNearNoun = new RegExp(`${numberToken}\\s*(?:-|to)\\s*${numberToken}\\s*${attendanceWords}\\b`, 'i')
  const singleNearNoun = new RegExp(`${numberToken}\\s*${attendanceWords}\\b`, 'i')
  const nounNearSingle = new RegExp(`${attendanceWords}\\s*(?:of|around|about|for|:)??\\s*${numberToken}`, 'i')

  const rangeMatch = message.match(rangeNearNoun)
  if (rangeMatch) {
    const low = parseHumanNumber(rangeMatch[1])
    const high = parseHumanNumber(rangeMatch[2])
    if (low && high) return { value: Math.max(low, high), confidence: 0.92 }
  }

  const singleMatch = message.match(singleNearNoun) ?? message.match(nounNearSingle)
  if (singleMatch) {
    const numericToken = singleMatch[singleMatch.length - 1]
    const value = parseHumanNumber(numericToken)
    if (value) return { value, confidence: 0.9 }
  }

  return null
}

function extractBudgetCap(message: string): { value: number; confidence: number } | null {
  const budgetNearMoney =
    /(?:budget|cap|spend|under|max|maximum|up to|total)\s*(?:of|is|at|around|about|:)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?\s*(?:k|m)?)/i
  const moneyNearBudget =
    /\$\s*(\d[\d,]*(?:\.\d+)?\s*(?:k|m)?)\s*(?:budget|cap|spend|total|max|maximum|all[-\s]?in)?/i

  const match = message.match(budgetNearMoney) ?? message.match(moneyNearBudget)
  if (!match) return null

  const value = parseMoneyToCents(match[1])
  if (!value) return null

  return { value, confidence: 0.9 }
}

function extractNeighborhood(lowerMessage: string): { value: string; confidence: number } | null {
  const areas = extractAreas(lowerMessage)
  if (areas[0]) return { value: areas[0], confidence: 0.94 }
  return null
}

function extractAreas(lowerMessage: string): string[] {
  const matches: Array<{ area: string; index: number }> = []

  for (const [match, canonical] of NEIGHBORHOODS) {
    const pattern = new RegExp(`\\b${escapeRegExp(match)}\\b`, 'i')
    const found = lowerMessage.match(pattern)
    if (found?.index != null && !matches.some((areaMatch) => areaMatch.area === canonical)) {
      matches.push({ area: canonical, index: found.index })
    }
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .map((match) => match.area)
}

function extractDateWindow(message: string):
  | { hint: string; start?: string; end?: string; confidence: number }
  | null {
  const lower = message.toLowerCase()
  const relativeWindow = extractRelativeDateWindow(lower)
  if (relativeWindow) return relativeWindow

  const ordinalWeekend = lower.match(
    /\b(first|second|third|last)\s+weekend\s+of\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  )
  if (ordinalWeekend) {
    const month = MONTHS[ordinalWeekend[2].toLowerCase()]
    const [startDay, endDay] = getOrdinalWeekendBand(ordinalWeekend[1].toLowerCase(), month)
    return {
      hint: ordinalWeekend[0].trim(),
      start: toIsoDate(DEFAULT_PLANNING_YEAR, month, startDay),
      end: toIsoDate(DEFAULT_PLANNING_YEAR, month, endDay),
      confidence: 0.76,
    }
  }

  const seasonalMatch = lower.match(/\bthis\s+(fall|summer|winter|spring)\b/)
  if (seasonalMatch) {
    const season = seasonalMatch[1]
    const ranges: Record<string, [string, string]> = {
      spring: [`${DEFAULT_PLANNING_YEAR}-03-01`, `${DEFAULT_PLANNING_YEAR}-05-31`],
      summer: [`${DEFAULT_PLANNING_YEAR}-06-01`, `${DEFAULT_PLANNING_YEAR}-08-31`],
      fall: [`${DEFAULT_PLANNING_YEAR}-09-01`, `${DEFAULT_PLANNING_YEAR}-11-30`],
      winter: [`${DEFAULT_PLANNING_YEAR}-12-01`, `${DEFAULT_PLANNING_YEAR + 1}-02-28`],
    }
    return {
      hint: `this ${season}`,
      start: ranges[season][0],
      end: ranges[season][1],
      confidence: 0.72,
    }
  }

  const monthRange = lower.match(
    /\b(early|mid|late)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?\b/i
  )
  if (monthRange) {
    const month = MONTHS[monthRange[2].toLowerCase()]
    const startDay = Number(monthRange[3])
    const endDay = monthRange[4] ? Number(monthRange[4]) : startDay
    return {
      hint: monthRange[0].trim(),
      start: toIsoDate(DEFAULT_PLANNING_YEAR, month, startDay),
      end: toIsoDate(DEFAULT_PLANNING_YEAR, month, endDay),
      confidence: 0.88,
    }
  }

  const vagueMonth = lower.match(
    /\b(early|mid|late)[-\s]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  )
  if (vagueMonth) {
    const modifier = vagueMonth[1].toLowerCase()
    const month = MONTHS[vagueMonth[2].toLowerCase()]
    const [startDay, endDay] = getMonthBand(modifier, month)
    return {
      hint: vagueMonth[0].trim(),
      start: toIsoDate(DEFAULT_PLANNING_YEAR, month, startDay),
      end: toIsoDate(DEFAULT_PLANNING_YEAR, month, endDay),
      confidence: 0.78,
    }
  }

  const weekdayHint = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(night|evening|morning|afternoon))?\b/i)
  if (weekdayHint) {
    return {
      hint: weekdayHint[0].trim(),
      confidence: 0.45,
    }
  }

  return null
}

function extractRelativeDateWindow(lowerMessage: string): { hint: string; start: string; end: string; confidence: number } | null {
  const weekWindow = lowerMessage.match(/\b(?:in\s+)?(?:the\s+)?next\s+(couple|few|one|two|three|four|\d+)\s+weeks?\b/i)
    ?? lowerMessage.match(/\bwithin\s+(?:the\s+)?(?:next\s+)?(couple|few|one|two|three|four|\d+)\s+weeks?\b/i)
  if (weekWindow) {
    return buildRelativeWindow(normalizeRelativeHint(weekWindow[0]), relativeNumber(weekWindow[1], 2) * 7)
  }

  const dayWindow = lowerMessage.match(/\b(?:in\s+)?(?:the\s+)?next\s+(couple|few|one|two|three|four|\d+)\s+days?\b/i)
    ?? lowerMessage.match(/\bwithin\s+(?:the\s+)?(?:next\s+)?(couple|few|one|two|three|four|\d+)\s+days?\b/i)
  if (dayWindow) {
    return buildRelativeWindow(normalizeRelativeHint(dayWindow[0]), relativeNumber(dayWindow[1], 3))
  }

  if (/\bnext\s+week\b/i.test(lowerMessage)) return buildRelativeWindow('next week', 7)
  if (/\bnext\s+month\b/i.test(lowerMessage)) return buildRelativeWindow('next month', 30)

  return null
}

function buildRelativeWindow(hint: string, days: number): { hint: string; start: string; end: string; confidence: number } {
  const today = startOfLocalDay(new Date())
  return {
    hint,
    start: toLocalIsoDate(addDays(today, 1)),
    end: toLocalIsoDate(addDays(today, days)),
    confidence: 0.76,
  }
}

function normalizeRelativeHint(value: string): string {
  return value.replace(/^(?:in|within)\s+(?:the\s+)?/i, '').replace(/^the\s+/i, '').trim()
}

function extractTicketed(lowerMessage: string): { value: boolean; confidence: number } | null {
  if (/\b(ticketed|paid|paid\s+ticket|sell\s+tickets?|tickets?\s+for\s+sale)\b/i.test(lowerMessage)) {
    return { value: true, confidence: 0.9 }
  }

  if (/\b(invite[-\s]?only|free|rsvp|rsvps?|guest\s+list)\b/i.test(lowerMessage)) {
    return { value: false, confidence: 0.86 }
  }

  return null
}

function extractFoodResponsibility(lowerMessage: string): { value: string; confidence: number } | null {
  if (/\b(open\s+bar|hosted\s+bar|hosted\s+food|organizer\s+pays|prepay|pre-paid|prepaid|food\s+included|meal\s+included)\b/i.test(lowerMessage)) {
    return { value: 'Organizer prepays food/beverage', confidence: 0.86 }
  }

  if (/\b(cash\s+bar|guests?\s+pay|pay\s+their\s+own|no-host\s+bar)\b/i.test(lowerMessage)) {
    return { value: 'Guests pay venue directly', confidence: 0.84 }
  }

  if (/\b(no\s+food|no\s+drinks|venue\s+only|no\s+f&b)\b/i.test(lowerMessage)) {
    return { value: 'No food/beverage needed', confidence: 0.8 }
  }

  return null
}

function extractCompoundEventComponents(message: string) {
  const lower = message.toLowerCase()
  if (!/\b(and|with|plus)\b/i.test(lower)) return []

  if (/\brooftop\s+mixer\b/i.test(lower) && /\bbrunch\b/i.test(lower)) {
    return [
      {
        label: 'rooftop mixer',
        role: 'primary' as const,
        archetype: 'social' as const,
        requirements: ['venue', 'drinks', 'networking'],
      },
      {
        label: 'brunch',
        role: 'secondary' as const,
        archetype: 'food' as const,
        requirements: ['food and beverage service'],
      },
    ]
  }

  return []
}

function extractProfitGoal(message: string): { value: number; confidence: number } | null {
  if (!/\b(profit|margin|net|make|earn)\b/i.test(message)) return null

  const money = message.match(/\$\s*(\d[\d,]*(?:\.\d+)?\s*(?:k|m)?)/i)
  if (!money) return null

  const value = parseMoneyToCents(money[1])
  if (!value) return null

  return { value, confidence: 0.72 }
}

function parseHumanNumber(token: string): number | null {
  const normalized = token.toLowerCase().replace(/,/g, '').replace(/\s+/g, '')
  const multiplier = normalized.endsWith('k') ? 1_000 : 1
  const value = Number.parseFloat(normalized.replace(/[km]$/, ''))

  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * multiplier)
}

function parseMoneyToCents(token: string): number | null {
  const normalized = token.toLowerCase().replace(/,/g, '').replace(/\s+/g, '')
  const suffix = normalized.match(/[km]$/)?.[0]
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const value = Number.parseFloat(normalized.replace(/[km]$/, ''))

  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * multiplier * 100)
}

function getMonthBand(modifier: string, month: number): [number, number] {
  if (modifier === 'early') return [1, 10]
  if (modifier === 'mid') return [11, 20]
  return [21, daysInMonth(DEFAULT_PLANNING_YEAR, month)]
}

function getOrdinalWeekendBand(ordinal: string, month: number): [number, number] {
  if (ordinal === 'last') {
    const lastDay = daysInMonth(DEFAULT_PLANNING_YEAR, month)
    return [Math.max(1, lastDay - 6), lastDay]
  }

  const startByOrdinal: Record<string, number> = {
    first: 1,
    second: 8,
    third: 15,
  }
  const start = startByOrdinal[ordinal] ?? 1
  return [start, Math.min(start + 6, daysInMonth(DEFAULT_PLANNING_YEAR, month))]
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toIsoDate(year: number, month: number, day: number): string {
  const paddedMonth = String(month).padStart(2, '0')
  const paddedDay = String(day).padStart(2, '0')
  return `${year}-${paddedMonth}-${paddedDay}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + days)
  return nextDate
}

function toLocalIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function relativeNumber(value: string, fallback: number): number {
  const normalized = value.toLowerCase()
  const wordMap: Record<string, number> = {
    one: 1,
    two: 2,
    couple: 2,
    three: 3,
    few: 3,
    four: 4,
  }

  const parsed = wordMap[normalized] ?? Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
