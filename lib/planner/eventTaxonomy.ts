/**
 * Shared event taxonomy fallback helpers for the Agent Planner.
 *
 * Purpose:
 * - Extract unsupported but plannable event phrases from freeform messages.
 * - Map them to safe fallback archetypes so the planner can continue.
 * - Produce a review payload that can be stored and promoted by an admin later.
 */
import type { EventComponent, EventPlanningArchetype, EventTaxonomyClassification } from '@/lib/types'

const GENERIC_EVENT_PHRASES = new Set([
  'event',
  'an event',
  'the event',
  'party',
  'a party',
  'thing',
  'something',
  'experience',
  'gathering',
])

const STOP_AFTER_PHRASE =
  /\s+(?:for|in|on|at|around|under|over|from|near|by|next|this|tomorrow|tonight|today|that|where|who|when)\b|[,.;!?]|\$/i

const EXPERIMENTAL_EVENT_PHRASES: Array<{
  phrase: string
  archetype: EventPlanningArchetype
}> = [
  { phrase: 'silent book club rave', archetype: 'music' },
  { phrase: 'exes apology dinner', archetype: 'food' },
  { phrase: 'strangers-only dinner party', archetype: 'food' },
  { phrase: 'anti-networking mixer', archetype: 'social' },
  { phrase: 'main character walk', archetype: 'social' },
  { phrase: 'group phone detox picnic', archetype: 'wellness' },
  { phrase: 'costume-only coffee crawl', archetype: 'food' },
  { phrase: 'compliment battle night', archetype: 'competitive_social' },
  { phrase: 'public speaking fear club', archetype: 'education' },
  { phrase: 'no-small-talk salon', archetype: 'social' },
  { phrase: 'chess boxing watch party', archetype: 'competitive_social' },
  { phrase: 'spreadsheet speedrun tournament', archetype: 'competitive_social' },
  { phrase: 'powerpoint karaoke battle', archetype: 'competitive_social' },
  { phrase: 'settlers of catan league night', archetype: 'competitive_social' },
  { phrase: 'mario kart bracket night', archetype: 'competitive_social' },
  { phrase: 'speed dating debate tournament', archetype: 'competitive_social' },
  { phrase: 'puzzle hunt bar crawl', archetype: 'competitive_social' },
  { phrase: 'trivia gauntlet', archetype: 'competitive_social' },
  { phrase: 'rock-paper-scissors championship', archetype: 'competitive_social' },
  { phrase: 'board game decathlon', archetype: 'competitive_social' },
  { phrase: 'pickleball founders mixer', archetype: 'sports' },
  { phrase: 'tennis social tournament', archetype: 'sports' },
  { phrase: '3-legged race fundraiser', archetype: 'sports' },
  { phrase: 'urban hike with checkpoints', archetype: 'sports' },
  { phrase: 'rooftop yoga disco', archetype: 'wellness' },
  { phrase: 'night run with mocktails', archetype: 'sports' },
  { phrase: 'dodgeball networking night', archetype: 'sports' },
  { phrase: 'spikeball beach league', archetype: 'sports' },
  { phrase: 'skate-and-sip meetup', archetype: 'sports' },
  { phrase: 'sauna and cold plunge social', archetype: 'wellness' },
  { phrase: 'soup swap', archetype: 'food' },
  { phrase: 'hot sauce tasting tournament', archetype: 'food' },
  { phrase: 'cereal bar brunch', archetype: 'food' },
  { phrase: 'midnight breakfast club', archetype: 'food' },
  { phrase: 'dumpling folding party', archetype: 'food' },
  { phrase: 'blindfolded wine tasting', archetype: 'food' },
  { phrase: 'zero-proof cocktail lab', archetype: 'food' },
  { phrase: 'nostalgia snack potluck', archetype: 'food' },
  { phrase: 'pizza thesis night', archetype: 'food' },
  { phrase: 'chili cookoff with investors', archetype: 'food' },
  { phrase: 'tiny desk concert in a warehouse', archetype: 'music' },
  { phrase: 'live diary reading night', archetype: 'performance' },
  { phrase: 'bad poetry salon', archetype: 'performance' },
  { phrase: 'one-minute film festival', archetype: 'performance' },
  { phrase: 'founder roast night', archetype: 'performance' },
  { phrase: 'karaoke confessional', archetype: 'music' },
  { phrase: 'improv pitch night', archetype: 'performance' },
  { phrase: 'album listening seance', archetype: 'music' },
  { phrase: 'open mic for product demos', archetype: 'professional' },
  { phrase: 'fashion show for thrift finds', archetype: 'performance' },
  { phrase: 'burnout recovery offsite', archetype: 'wellness' },
  { phrase: 'coworking lock-in', archetype: 'professional' },
  { phrase: 'founder failure wake', archetype: 'professional' },
  { phrase: 'ai prompt jam', archetype: 'professional' },
  { phrase: 'pitch deck funeral', archetype: 'professional' },
  { phrase: 'demo day in a boxing gym', archetype: 'professional' },
  { phrase: 'no-laptops strategy retreat', archetype: 'professional' },
  { phrase: 'investor speed dating', archetype: 'professional' },
  { phrase: 'customer therapy circle', archetype: 'professional' },
  { phrase: 'startup intervention dinner', archetype: 'professional' },
  { phrase: 'secret rooftop sunset club', archetype: 'social' },
  { phrase: 'ferry ride networking event', archetype: 'professional' },
  { phrase: 'warehouse treasure hunt', archetype: 'competitive_social' },
  { phrase: 'speakeasy puzzle dinner', archetype: 'competitive_social' },
  { phrase: 'museum after-hours mixer', archetype: 'social' },
  { phrase: 'neon night market', archetype: 'market' },
  { phrase: 'underground supper club', archetype: 'food' },
  { phrase: 'citywide scavenger race', archetype: 'competitive_social' },
  { phrase: 'pop-up beach office', archetype: 'professional' },
  { phrase: 'parking lot drive-in screening', archetype: 'performance' },
]

/**
 * Classifies a message into an unsupported-event fallback when no supported
 * taxonomy event type matched.
 *
 * @param message - User-authored planning message.
 * @param supportedEventType - Supported parser match, if already found.
 * @returns Classification payload for review and fallback planning, or null.
 */
export function classifyUnsupportedEventType(
  message: string,
  supportedEventType?: string | null
): EventTaxonomyClassification | null {
  const knownExperimentalEvent = findExperimentalEventPhrase(message)
  if (supportedEventType && !knownExperimentalEvent) return null

  const rawEventType = knownExperimentalEvent?.phrase ?? extractUnsupportedEventPhrase(message)
  if (!rawEventType) return null

  const eventComponents = buildEventComponents(rawEventType)
  const primaryComponent = eventComponents.find((component) => component.role === 'primary') ?? eventComponents[0]
  const secondaryComponents = eventComponents
    .filter((component) => component.role === 'secondary')
    .map((component) => component.label)
  const planningArchetype = knownExperimentalEvent?.archetype ?? primaryComponent?.archetype ?? inferPlanningArchetype(rawEventType)
  const normalizedPhrase = normalizeEventPhrase(rawEventType)

  return {
    raw_event_type: rawEventType,
    normalized_phrase: normalizedPhrase,
    planning_archetype: planningArchetype,
    event_components: eventComponents,
    primary_component: primaryComponent?.label ?? rawEventType,
    secondary_components: secondaryComponents,
    suggested_event_type: toTitleCase(rawEventType),
    suggested_questions: buildSuggestedQuestions(rawEventType, planningArchetype, eventComponents),
    is_unsupported_but_plannable: true,
    confidence: normalizedPhrase.split(' ').length > 1 ? 'medium' : 'low',
  }
}

/**
 * Normalizes a raw event phrase for grouping and review queues.
 *
 * @param value - Raw event phrase.
 * @returns Lowercase phrase with filler words and duplicate whitespace removed.
 */
export function normalizeEventPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractUnsupportedEventPhrase(message: string): string | null {
  const compact = message.replace(/\s+/g, ' ').trim()
  const phrasePatterns = [
    /\b(?:host|plan|organize|throw|create|run|book)\s+(?:a|an|the)?\s*([a-z][a-z0-9&' -]{2,80})/i,
    /\b(?:i\s+want\s+to|i'd\s+like\s+to|we\s+want\s+to)\s+(?:host|plan|organize|throw|create|run)\s+(?:a|an|the)?\s*([a-z][a-z0-9&' -]{2,80})/i,
  ]

  for (const pattern of phrasePatterns) {
    const match = compact.match(pattern)
    const phrase = match ? cleanExtractedPhrase(match[1]) : null
    if (phrase) return phrase
  }

  return null
}

function findExperimentalEventPhrase(message: string) {
  const normalizedMessage = normalizeEventPhrase(message)
  return EXPERIMENTAL_EVENT_PHRASES
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .find(({ phrase }) => normalizedMessage.includes(phrase))
}

function cleanExtractedPhrase(value: string): string | null {
  const [beforeStop] = value.split(STOP_AFTER_PHRASE)
  const cleaned = beforeStop
    .replace(/\b(?:in|at|on|for|with(?:\s+(?:a|an|the))?|and)$/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned.length < 3) return null
  if (GENERIC_EVENT_PHRASES.has(cleaned.toLowerCase())) return null
  return cleaned
}

function buildEventComponents(rawEventType: string): EventComponent[] {
  const parts = rawEventType
    .split(/\s+(?:with|and|plus|followed by|then)\s+|\s*\+\s*/i)
    .map((part) => cleanComponentLabel(part))
    .filter((part) => part.length > 0)

  const componentLabels = parts.length > 0 ? parts : [rawEventType]

  return componentLabels.map((label, index) => {
    const archetype = inferPlanningArchetype(label)
    return {
      label,
      role: index === 0 ? 'primary' : 'secondary',
      archetype,
      requirements: inferComponentRequirements(label, archetype),
    }
  })
}

function cleanComponentLabel(value: string): string {
  return value
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/\b(?:in|at|on|for|with(?:\s+(?:a|an|the))?|and)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferPlanningArchetype(rawEventType: string): EventPlanningArchetype {
  const lower = rawEventType.toLowerCase()

  if (/\b(pickleball|basketball|soccer|golf|volleyball|softball|baseball|running|run|cycling|bike|climbing|skate|sports?)\b/i.test(lower)) {
    return 'sports'
  }
  if (/\b(chess|trivia|poker|gaming|game night|tournament|competition|league|match|battle|championship|gauntlet|decathlon|bracket|speedrun|puzzle hunt|treasure hunt|scavenger)\b/i.test(lower)) {
    return 'competitive_social'
  }
  if (/\b(dinner|brunch|lunch|supper|tasting|wine|cocktails?|mocktails?|coffee|food|drinks?|soup|hot sauce|cereal|breakfast|dumpling|snack|pizza|chili|cookoff|potluck)\b/i.test(lower)) {
    return 'food'
  }
  if (/\b(concert|music|dj|listening|karaoke|band|show|rave|disco|album)\b/i.test(lower)) {
    return 'music'
  }
  if (/\b(panel|talk|founder|networking|demo|investor|startup|sales|customer|professional|pitch deck|strategy|coworking|prompt jam|offsite)\b/i.test(lower)) {
    return 'professional'
  }
  if (/\b(workshop|class|course|lesson|clinic|training|seminar)\b/i.test(lower)) {
    return 'education'
  }
  if (/\b(market|popup|pop-up|fair|bazaar|swap)\b/i.test(lower)) {
    return 'market'
  }
  if (/\b(birthday|wedding|reunion|anniversary|shower|private)\b/i.test(lower)) {
    return 'private'
  }
  if (/\b(screening|film|theater|comedy|poetry|gallery|art|performance)\b/i.test(lower)) {
    return 'performance'
  }
  if (/\b(yoga|pilates|wellness|meditation|breathwork|fitness|detox|burnout|sauna|cold plunge)\b/i.test(lower)) {
    return 'wellness'
  }
  if (/\b(mixer|social|meetup|hangout|club)\b/i.test(lower)) {
    return 'social'
  }

  return 'custom'
}

function inferComponentRequirements(label: string, archetype: EventPlanningArchetype): string[] {
  const lower = label.toLowerCase()
  const requirements = new Set<string>()

  if (/\b(night run|run|running)\b/i.test(lower)) {
    requirements.add('route plan')
    requirements.add('post-run meetup location')
    requirements.add('visibility and safety plan')
  }
  if (/\b(mocktail|zero-proof|cocktail|drinks?)\b/i.test(lower)) {
    requirements.add('zero-proof beverage vendor')
    requirements.add('bar setup')
    requirements.add('post-activity service window')
  }
  if (/\b(chess|trivia|poker|tournament|competition)\b/i.test(lower)) {
    requirements.add('tables and seating')
    requirements.add('bracket/check-in support')
    requirements.add('prize table')
  }
  if (/\b(dj|music|karaoke|band)\b/i.test(lower)) {
    requirements.add('sound system')
    requirements.add('music/DJ support')
  }

  if (requirements.size === 0) {
    const defaults: Record<EventPlanningArchetype, string[]> = {
      social: ['flexible social layout'],
      sports: ['activity area', 'post-activity gathering space'],
      competitive_social: ['seating', 'check-in support'],
      food: ['food and beverage service'],
      music: ['sound system'],
      professional: ['AV and check-in'],
      education: ['classroom seating'],
      market: ['vendor setup'],
      private: ['private room'],
      performance: ['stage or presentation area'],
      wellness: ['instructor area'],
      custom: ['custom setup notes'],
    }
    for (const requirement of defaults[archetype]) requirements.add(requirement)
  }

  return Array.from(requirements)
}

function buildSuggestedQuestions(
  rawEventType: string,
  archetype: EventPlanningArchetype,
  eventComponents: EventComponent[]
): string[] {
  const baseQuestions = [
    `What date or time window should I plan around for the ${rawEventType}?`,
    'How many people should I plan for?',
    'What city or neighborhood should I prioritize?',
  ]

  const secondaryComponents = eventComponents
    .filter((component) => component.role === 'secondary')
    .map((component) => component.label)
  const compoundQuestion =
    secondaryComponents.length > 0
      ? [`Should ${secondaryComponents.join(' and ')} happen during the event, after the main activity, or both?`]
      : []

  const archetypeQuestions: Record<EventPlanningArchetype, string> = {
    social: 'Do you want food, drinks, music, or a simple RSVP-only setup?',
    sports: 'Do you need reserved courts/fields, equipment, coaching, or post-play food and drinks?',
    competitive_social: 'Do you need tables/seating, brackets, check-in, prizes, or a quieter room?',
    food: 'Do you want a restaurant/private dining room, caterer, or venue with outside food allowed?',
    music: 'Do you need a stage, sound system, green room, or DJ/artist support?',
    professional: 'Do you need seated programming, AV, recording, check-in, or sponsor visibility?',
    education: 'Do you need classroom seating, supplies, instructor support, or breakout tables?',
    market: 'Do you need vendor booths, foot traffic, permits, POS, or storage?',
    private: 'Do you need private dining, decor, photographer, music, or a cake/dessert vendor?',
    performance: 'Do you need stage, lighting, projection, sound, or audience seating?',
    wellness: 'Do you need mats, instructor support, changing rooms, or an indoor rain plan?',
    custom: 'What would make this event work well: layout, vibe, services, or special equipment?',
  }

  return [...baseQuestions, ...compoundQuestion, archetypeQuestions[archetype]]
}

function toTitleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}
