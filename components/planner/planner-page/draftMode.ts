'use client'

import { resolveArchetypeContext } from '@/lib/planner/archetypes'
import { humanizeEventType } from '@/lib/planner/archetypes/driftControl'
import type { Plan, PlanMessage } from '@/lib/types'
import type { PlannerPersistenceMode, PublicDraftIntakeData } from './types'
import { readRecord } from './plannerState'

export function buildMockPlan(message: string): Plan {
  const now = new Date().toISOString()
  const eventType = detectMockEventType(message)
  const displayEventType = resolveArchetypeContext(message)?.display_name ?? eventType
  const title = displayEventType ? `${humanizeEventType(displayEventType) ?? displayEventType} plan` : 'Event plan'

  return {
    id: `mock-plan-${Date.now()}`,
    user_id: 'mock-user',
    title,
    event_type: eventType,
    status: 'drafting',
    guest_count: detectMockGuestCount(message),
    budget_cap_cents: detectMockBudgetCap(message),
    neighborhood: detectMockNeighborhood(message),
    date_window_start: null,
    date_window_end: null,
    ticketed: /\b(ticketed|paid|tickets?)\b/i.test(message),
    profit_goal_cents: null,
    notes: 'Private draft - not saved to your account yet. Sign up to save this plan.',
    created_at: now,
    updated_at: now,
  }
}

export async function tryRunPublicDraftIntake(message: string, plan: Plan): Promise<PublicDraftIntakeData | null> {
  try {
    const response = await fetch('/api/planner/public-intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_message: message,
        current_plan: plan,
      }),
    })
    const payload = await response.json().catch(() => null) as { data?: PublicDraftIntakeData; error?: string } | null

    if (!response.ok || !payload?.data) {
      throw new Error(payload?.error ?? 'Public intake unavailable')
    }

    return payload.data
  } catch (error) {
    console.warn('[planner.public-intake] Falling back to deterministic draft:', error)
    return null
  }
}

export async function buildDeterministicDraftExchange(
  message: string,
  plan: Plan,
  conversationMessages: PlanMessage[]
): Promise<{ finalPlan: Plan; agentMessages: PlanMessage[] }> {
  const { getMockAgentResponse } = await import('@/lib/planner/mockAgentResponses')
  const mockResponse = getMockAgentResponse(conversationMessages, message, plan)
  const finalPlan = applyMockPlanPatch(plan, mockResponse.planPatch)
  const agentMessages = mockResponse.messages.map((agentMessage) =>
    buildMockMessage(
      finalPlan.id,
      agentMessage.role,
      agentMessage.content,
      agentMessage.message_type,
      agentMessage.metadata
    )
  )

  return { finalPlan, agentMessages }
}

export function buildDraftMatchHandoff(
  plan: Plan,
  agentMessages: PlanMessage[],
  existingMessages: PlanMessage[] = []
): { plan: Plan; agentMessages: PlanMessage[] } {
  if (!agentMessages.some(isDraftRecommendationTransition)) {
    return { plan, agentMessages }
  }

  const readyPlan: Plan = {
    ...plan,
    status: 'ready',
    updated_at: new Date().toISOString(),
  }
  const nonExecutableMessages = agentMessages.filter(
    (message) => message.message_type !== 'recommendation' && message.message_type !== 'approval_request'
  )

  if (hasDraftMatchGateMessage(existingMessages)) {
    return { plan: readyPlan, agentMessages: nonExecutableMessages }
  }

  return {
    plan: readyPlan,
    agentMessages: [
      ...nonExecutableMessages,
      buildDraftMatchGateMessage(readyPlan),
    ],
  }
}

export function isDraftRecommendationTransition(message: PlanMessage) {
  if (message.message_type === 'recommendation') return true
  const metadata = readRecord(message.metadata)
  return metadata?.transition_to_match === true || metadata?.state === 'recommendations_shown'
}

export function hasDraftMatchGateMessage(messages: PlanMessage[]) {
  return messages.some((message) => readRecord(message.metadata)?.state === 'draft_match_signup_gate')
}

export function buildDraftMatchGateMessage(plan: Plan): PlanMessage {
  const eventType = plan.event_type ? (humanizeEventType(plan.event_type) ?? plan.event_type) : 'event'
  const area = plan.neighborhood ?? 'your target area'
  const guestText = typeof plan.guest_count === 'number' && plan.guest_count > 0
    ? ` for ${plan.guest_count.toLocaleString()} guests`
    : ''

  return buildMockMessage(
    plan.id,
    'agent',
    `I have enough to match venues and vendors for this ${eventType.toLowerCase()}${guestText} in ${area}. Create a planner account to save this draft and unlock real venue matches, vendor picks, financial projections, and approval cards.`,
    'status_update',
    {
      state: 'draft_match_signup_gate',
      requires_auth: true,
      next_action: 'signup_to_match',
    }
  )
}

/**
 * Applies defined mock-agent plan fields without wiping existing context.
 */
export function applyMockPlanPatch(plan: Plan, patch: Partial<Plan>): Plan {
  const eventType = patch.event_type ?? plan.event_type
  const incomingEventType = patch.event_type ?? null
  const shouldUpdateTitle =
    patch.event_type !== undefined &&
    (incomingEventType ?? '').trim().toLowerCase() !== (plan.event_type ?? '').trim().toLowerCase()
  return {
    ...plan,
    title: shouldUpdateTitle && eventType ? `${humanizeEventType(eventType) ?? eventType} plan` : plan.title,
    event_type: eventType,
    status: patch.status ?? plan.status,
    guest_count: patch.guest_count ?? plan.guest_count,
    budget_cap_cents: patch.budget_cap_cents ?? plan.budget_cap_cents,
    neighborhood: patch.neighborhood ?? plan.neighborhood,
    date_window_start:
      patch.date_window_start === undefined ? plan.date_window_start : patch.date_window_start,
    date_window_end:
      patch.date_window_end === undefined ? plan.date_window_end : patch.date_window_end,
    ticketed: patch.ticketed ?? plan.ticketed,
    ticketing_model:
      patch.ticketing_model === undefined ? plan.ticketing_model : patch.ticketing_model,
    food_responsibility:
      patch.food_responsibility === undefined ? plan.food_responsibility : patch.food_responsibility,
    venue_terms: patch.venue_terms === undefined ? plan.venue_terms : patch.venue_terms,
    agent_action: patch.agent_action === undefined ? plan.agent_action : patch.agent_action,
    profit_goal_cents:
      patch.profit_goal_cents === undefined ? plan.profit_goal_cents : patch.profit_goal_cents,
    notes: patch.notes ?? plan.notes,
    metadata: patch.metadata === undefined
      ? plan.metadata
      : ({
          ...(readRecord(plan.metadata) ?? {}),
          ...(readRecord(patch.metadata) ?? {}),
        } as Plan['metadata']),
    updated_at: patch.updated_at ?? new Date().toISOString(),
  }
}

export function shouldUseMockReplyPath(
  persistenceMode: PlannerPersistenceMode,
  planId: string
): boolean {
  const isMockPlan = planId.startsWith('mock-plan-')
  const isRealServerPlan = persistenceMode === 'server' && !isMockPlan
  if (isRealServerPlan) return false

  return persistenceMode === 'draft' || isMockPlan
}

export function buildMockMessage(
  planId: string,
  role: PlanMessage['role'],
  content: string,
  messageType: PlanMessage['message_type'],
  metadata: Record<string, unknown>
): PlanMessage {
  return {
    id: `mock-message-${role}-${messageType}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    plan_id: planId,
    role,
    content,
    message_type: messageType,
    metadata: metadata as PlanMessage['metadata'],
    created_at: new Date().toISOString(),
  }
}

interface MockAgentReply {
  content: string
  messageType: PlanMessage['message_type']
  metadata: Record<string, unknown>
}

interface MockQuestion {
  label: string
  prompt: string
}

interface MockPlanGaps {
  missingFields: string[]
  questions: MockQuestion[]
}

/**
 * Returns the next deterministic draft reply without repeating prior prompts.
 */
export function buildMockAgentReply(
  plan: Plan,
  userMessage: string,
  conversationText: string,
  previousMetadata?: PlanMessage['metadata']
): MockAgentReply {
  const previousState = readMockState(previousMetadata)
  const gaps = buildMockPlanGaps(plan, conversationText)

  if (gaps.questions.length > 0) {
    return {
      messageType: 'confirmation_card',
      content: buildClarifyingContent(plan, gaps, shouldShowRecommendations(userMessage)),
      metadata: buildClarifyingMetadata(plan, conversationText, gaps, previousState === 'recommending' ? 'details_requested' : 'clarifying'),
    }
  }

  if (previousState === 'recommendations_shown') {
    return {
      messageType: 'approval_request',
      content:
        'Next step: pick one option and I can prepare the booking packet. In the real product this is where I would open the booking link, request a venue hold, email the vendor, or ask for authorization before payment.',
      metadata: {
        state: 'awaiting_approval',
        approval: {
          id: `mock-approval-${plan.id}`,
          label: 'Request venue hold + vendor availability',
          amount_cents: plan.budget_cap_cents ? Math.round(plan.budget_cap_cents * 0.55) : 0,
          provider: '3rdPlace team',
          event_date: plan.date_window_start ?? '',
          delivery_email: 'you@example.com',
          terms: 'No payment is made from a private draft. User approval required before real booking.',
          status: 'pending',
        },
      },
    }
  }

  if (previousState === 'recommending' || shouldShowRecommendations(userMessage)) {
    return {
      messageType: 'recommendation',
      content:
        'Here are three mock venue and vendor paths. In production these would be real catalog matches, external booking links, or team-handled hold requests.',
      metadata: {
        state: 'recommendations_shown',
        recommendation_type: 'venue_vendor',
        recommendations: buildMockRecommendations(plan),
        next_actions: [
          'Open venue booking link',
          'Request a 24-hour hold',
          'Email vendor package request',
          'Create approval card before payment',
        ],
      },
    }
  }

  return {
    messageType: 'recommendation',
    content:
      'I have enough to generate venue and vendor recommendations. Say "show me" and I will display three booking paths with estimated cost, fit, and next action.',
    metadata: {
      state: 'recommending',
      missing_fields: [],
      recommendation_type: 'venue',
      next_action: 'generate_recommendations',
    },
  }
}

export function buildMockClarifyingReply(plan: Plan, conversationText: string): MockAgentReply {
  const gaps = buildMockPlanGaps(plan, conversationText)

  return {
    messageType: 'confirmation_card',
    content: buildClarifyingContent(plan, gaps, false),
    metadata: buildClarifyingMetadata(plan, conversationText, gaps, 'clarifying'),
  }
}

export function buildClarifyingContent(plan: Plan, gaps: MockPlanGaps, userRequestedRecommendations: boolean): string {
  if (gaps.questions.length === 0) {
    return 'I have the core context. Say "show me" and I will display venue, vendor, and booking options.'
  }

  const nextQuestion = gaps.questions[0]
  const prefix = userRequestedRecommendations ? 'Before I show recommendations, I need one more planning detail:' : ''

  return prefix ? `${prefix}\n${nextQuestion.prompt}` : nextQuestion.prompt
}

export function buildClarifyingMetadata(
  plan: Plan,
  conversationText: string,
  gaps: MockPlanGaps,
  state: string
): Record<string, unknown> {
  return {
    state,
    missing_fields: gaps.missingFields.slice(0, 1),
    confirmation_items: [
      { label: 'Experience', value: humanizeEventType(plan.event_type) ?? 'Event', confirmed: Boolean(plan.event_type) },
      { label: 'Date + time', value: detectLegacyDateSignal(conversationText) ?? 'Need date', confirmed: hasDateSignal(conversationText) },
      { label: 'City / area', value: plan.neighborhood ?? 'Need city', confirmed: Boolean(plan.neighborhood) },
      { label: 'Headcount', value: plan.guest_count ? `${plan.guest_count} people` : 'Need headcount', confirmed: Boolean(plan.guest_count) },
      { label: 'Budget cap', value: plan.budget_cap_cents ? formatMockCents(plan.budget_cap_cents) : 'Need budget', confirmed: Boolean(plan.budget_cap_cents) },
      { label: 'Ticketing link', value: hasTicketOrRsvpSignal(conversationText) ? 'Ticket/RSVP planned' : 'Need ticket or RSVP plan', confirmed: hasTicketOrRsvpSignal(conversationText) },
    ],
    questions: gaps.questions.slice(0, 1),
  }
}

export function buildMockPlanGaps(plan: Plan, conversationText: string): MockPlanGaps {
  const missingFields: string[] = []
  const questions: MockQuestion[] = []

  if (!hasDateSignal(conversationText)) {
    missingFields.push('date_time')
    questions.push({ label: 'When', prompt: 'What day and time window should I plan around?' })
  }

  if (!plan.neighborhood && !hasCitySignal(conversationText)) {
    missingFields.push('city_area')
    questions.push({ label: 'Where', prompt: 'What city or neighborhood should I search in?' })
  }

  if (!plan.guest_count) {
    missingFields.push('headcount')
    questions.push({ label: 'Headcount', prompt: 'Roughly how many people are you expecting?' })
  }

  if (!hasTicketOrRsvpSignal(conversationText)) {
    missingFields.push('ticketing')
    questions.push({ label: 'Ticketing', prompt: 'Is this ticketed, RSVP-only, free, invite-only, or do you already have a Luma/Eventbrite/Posh link?' })
  }

  const eventQuestions = getEventSpecificQuestions(plan.event_type)
  for (const question of eventQuestions) {
    if (!question.isAnswered(conversationText)) {
      missingFields.push(question.field)
      questions.push({ label: question.label, prompt: question.prompt })
    }
  }

  return {
    missingFields,
    questions: questions.slice(0, 7),
  }
}

export function isMockPlanCoherent(plan: Plan, conversationText: string): boolean {
  return buildMockPlanGaps(plan, conversationText).questions.length === 0
}

interface EventSpecificQuestion {
  field: string
  label: string
  prompt: string
  isAnswered: (conversationText: string) => boolean
}

export function getEventSpecificQuestions(eventType: string | null): EventSpecificQuestion[] {
  const normalized = eventType?.toLowerCase() ?? 'event'
  const shared: EventSpecificQuestion[] = [
    {
      field: 'venue_status',
      label: 'Venue status',
      prompt: 'Do you already have your own venue, or should I find one?',
      isAnswered: hasVenueStatusSignal,
    },
    {
      field: 'venue_priority',
      label: 'Venue fit',
      prompt: 'What should make the place a fit: vibe, neighborhood, outdoor space, bar economics, capacity, or privacy?',
      isAnswered: (text) => /\b(vibe|neighborhood|outdoor|patio|rooftop|bar economics|capacity|privacy|private|why that place|venue fit|location|look|feel)\b/i.test(text),
    },
  ]

  const questionBank: Record<string, EventSpecificQuestion[]> = {
    dinner: [
      ...shared,
      question('cuisine', 'Cuisine', 'What cuisine or dining style do you want?', /\b(cuisine|italian|mexican|japanese|chinese|thai|mediterranean|tasting|family-style|prix fixe|steak|vegan|vegetarian|sushi|seafood)\b/i),
      question('private_room', 'Room type', 'Do you need a private room or is a semi-private table okay?', /\b(private room|semi-private|private table|buyout|chef's table|shared table)\b/i),
      question('menu_terms', 'Menu terms', 'Do you want a preset menu, minimum spend, or a la carte ordering?', /\b(preset menu|prix fixe|minimum spend|a la carte|family-style|deposit|menu)\b/i),
    ],
    mixer: [
      ...shared,
      question('audience', 'Audience', 'Who is the target audience: founders, investors, operators, members, or open community?', /\b(founders?|investors?|operators?|members?|community|students?|creators?|audience)\b/i),
      question('food_drink', 'Food + drink', 'Should this be drinks-only, light bites, full catering, or sponsor-hosted?', /\b(drinks?|bar|bites|catering|food|sponsor-hosted|sponsored)\b/i),
      question('check_in', 'Check-in', 'Do you need check-in, name tags, or sponsor capture at the door?', /\b(check-?in|name tags?|badges?|sponsor capture|door|registration)\b/i),
    ],
    'day party': [
      ...shared,
      question('dj', 'Music', 'Do you need a DJ, or are you bringing your own music?', /\b(dj|music|playlist|sound)\b/i),
      question('alcohol', 'Alcohol', 'Do you plan on bringing your own alcohol, using a bar package, or keeping it non-alcoholic?', /\b(alcohol|bar|byob|bring.*own|cocktails?|drinks?|non-alcoholic)\b/i),
      question('bar_consumption_share', 'Bar economics', 'Do you want a Community Host Incentive, minimum spend, or no bar terms?', /\b(community host incentive|chi|consumption share|minimum spend|no bar terms|no chi)\b/i),
      question('exclusive_use', 'Access', 'Do you want exclusive use / buyout, or is shared space okay?', /\b(exclusive|buyout|private|shared)\b/i),
    ],
    'listening party': [
      ...shared,
      question('artist_music', 'Music focus', 'What artist, album, or release should the listening experience center on?', /\b(artist|album|release|track|music|listening|dj|label)\b/i),
      question('sound_quality', 'Sound quality', 'How important is premium sound, DJ equipment, or playback control?', /\b(sound|speakers?|dj equipment|playback|audio|av|premium)\b/i),
      question('vip_guestlist', 'Guest list', 'Do you need VIP sections, press, artist guests, or a controlled guest list?', /\b(vip|press|artist guests?|guest list|controlled|invite)\b/i),
    ],
    'launch party': [
      ...shared,
      question('brand_product', 'Launch focus', 'What brand, product, or release is being launched?', /\b(brand|product|release|launch|startup|company|app)\b/i),
      question('demo_press', 'Demo + press', 'Do you need demo stations, press moments, photography, or speaking remarks?', /\b(demo|press|photography|photo|remarks|speech|presentation)\b/i),
      question('sponsor_needs', 'Sponsors', 'Are there sponsors, partners, or brand requirements to include?', /\b(sponsor|partner|brand requirements|activation|booth)\b/i),
    ],
    birthday: [
      ...shared,
      question('birthday_vibe', 'Vibe', 'What kind of birthday is this: dinner, dancing, cocktails, day party, or private room?', /\b(dinner|dancing|cocktails?|day party|private room|vibe|theme)\b/i),
      question('music_cake', 'Music + cake', 'Do you need music, cake, decorations, or a photographer?', /\b(music|dj|cake|decor|decorations|photographer|photos)\b/i),
      question('hosted_bar', 'Food + drinks', 'Should food and drinks be hosted, cash bar, or split by guests?', /\b(hosted|cash bar|split|guests pay|open bar|food|drinks)\b/i),
    ],
    'house party': [
      question('space_type', 'Space', 'Is this at someone’s home, apartment, rooftop, or a rented space?', /\b(home|house|apartment|rooftop|rented space|venue)\b/i),
      question('private_public', 'Privacy', 'Is it private invite-only, public RSVP, or ticketed?', /\b(private|invite-only|public|rsvp|ticketed)\b/i),
      question('supplies', 'Supplies', 'Do you need supplies, catering, drinks, speakers, or cleanup?', /\b(supplies|catering|drinks|speakers|cleanup|security)\b/i),
    ],
    concert: [
      ...shared,
      question('artist_lineup', 'Artist', 'Who is the artist or lineup, and are they already confirmed?', /\b(artist|lineup|band|performer|confirmed|talent)\b/i),
      question('production', 'Production', 'Do you need stage, sound, lighting, backline, or security?', /\b(stage|sound|lighting|backline|security|production|av)\b/i),
      question('ticket_price', 'Ticket price', 'What ticket price or gross revenue target should I model?', /\b(ticket price|price|gross|revenue|ga|vip)\b/i),
    ],
    'club night': [
      ...shared,
      question('music_genre', 'Music genre', 'What genre, DJ style, or nightlife format should this be?', /\b(genre|dj|house|hip hop|dance|latin|afrobeats|nightlife|format)\b/i),
      question('door_split', 'Door economics', 'Do you want a door incentive, bar incentive, flat rental, or minimum spend?', /\b(door incentive|bar incentive|flat rental|minimum spend|chi)\b/i),
      question('security_promo', 'Ops + promo', 'Do you need security, promoters, VIP tables, or guest list management?', /\b(security|promoters?|vip tables?|guest list|bottle service)\b/i),
    ],
    'run club': [
      question('route', 'Route', 'Do you have a route and pace, or should I suggest one?', /\b(route|pace|miles|5k|jog|loop|start point|finish point)\b/i),
      question('post_run', 'Post-run', 'Do you want a coffee, bar, or brunch stop after?', /\b(coffee|bar|brunch|after|post-run)\b/i),
      question('waivers', 'Safety', 'Do you need waivers, captains, water, or permits?', /\b(waiver|captain|water|permit|safety)\b/i),
    ],
    'fitness class': [
      ...shared,
      question('instructor', 'Instructor', 'Do you already have an instructor, or should I source one?', /\b(instructor|teacher|coach|trainer|source one|have one)\b/i),
      question('equipment', 'Equipment', 'Do you need mats, weights, towels, sound, or other gear?', /\b(mats?|weights?|towels?|gear|equipment|sound)\b/i),
      question('rain_plan', 'Rain plan', 'Does this need to be indoor-only, outdoor, or have a rain plan?', /\b(indoor|outdoor|rain plan|weather|park|studio)\b/i),
    ],
    workshop: [
      ...shared,
      question('topic_outcome', 'Topic', 'What topic and attendee outcome should the workshop deliver?', /\b(topic|outcome|learn|takeaway|curriculum|workshop)\b/i),
      question('materials', 'Materials', 'Do you need supplies, worktables, screens, or printed materials?', /\b(supplies|materials|tables|screens?|printed|handouts)\b/i),
      question('instructor', 'Instructor', 'Who is teaching or facilitating?', /\b(instructor|teacher|facilitator|speaker|host)\b/i),
    ],
    panel: [
      ...shared,
      question('speakers', 'Speakers', 'Who are the speakers and moderator, or should I help source them?', /\b(speakers?|moderator|panelists?|source them|confirmed)\b/i),
      question('seating_av', 'Seating + AV', 'Do you need theater seating, microphones, recording, or livestream?', /\b(theater|seating|microphones?|mics?|recording|livestream|av)\b/i),
      question('qa_networking', 'Run of show', 'Should there be audience Q&A, networking, or sponsor remarks?', /\b(q&a|qa|networking|sponsor remarks|remarks|run of show)\b/i),
    ],
    conference: [
      ...shared,
      question('agenda_tracks', 'Agenda', 'What agenda, tracks, or session blocks should I plan around?', /\b(agenda|tracks?|sessions?|keynote|breakout|schedule)\b/i),
      question('sponsors', 'Sponsors', 'Do you have sponsors, booths, or partner activations?', /\b(sponsors?|booths?|partners?|activations?)\b/i),
      question('ticketing_ops', 'Ticketing + ops', 'Do you need ticket tiers, check-in, badges, meals, or livestream?', /\b(ticket tiers?|check-?in|badges?|meals?|livestream|operations)\b/i),
    ],
    hackathon: [
      ...shared,
      question('duration_overnight', 'Duration', 'Is it overnight, 12-hour, 24-hour, 36-hour, or weekend format?', /\b(overnight|12-hour|24-hour|36-hour|weekend|duration)\b/i),
      question('wifi_power', 'Infrastructure', 'Do you need high-speed wifi, power strips, rooms, showers, or overnight security?', /\b(wifi|power|rooms|showers|overnight security|security)\b/i),
      question('food_prizes', 'Food + prizes', 'Do you need meals, snacks, prizes, judges, or demo day production?', /\b(meals?|snacks?|prizes?|judges?|demo day|production)\b/i),
    ],
    'demo day': [
      ...shared,
      question('startups_investors', 'Audience', 'How many startups, investors, and general guests should I plan for?', /\b(startups?|investors?|guests?|founders?|audience)\b/i),
      question('pitch_format', 'Pitch format', 'What is the pitch format: stage demos, expo tables, judging, or awards?', /\b(stage demos?|expo|tables|judging|awards|pitch format)\b/i),
      question('recording_catering', 'Production', 'Do you need recording, livestream, catering, or investor check-in?', /\b(recording|livestream|catering|check-?in|investor)\b/i),
    ],
    'game outing': [
      question('team_game', 'Game', 'Which team/game/date should I target, and do seats need to be together?', /\b(giants|warriors|49ers|game|seats together|section|row|team)\b/i),
      question('seat_budget', 'Seats', 'What is the target seat budget per person and preferred section?', /\b(seat budget|per person|section|lower bowl|upper|club level|bleachers)\b/i),
      question('ticket_delivery', 'Ticket delivery', 'What email should receive the tickets if you approve purchase?', /@|email/i),
      question('pre_post', 'Before / after', 'Do you want food or drinks before or after the game?', /\b(before|after|dinner|drinks|pregame|postgame|bar|restaurant)\b/i),
    ],
    'watch party': [
      ...shared,
      question('screen_sound', 'Screen + sound', 'What screen size and sound setup do you need?', /\b(screen|projector|tv|sound|audio|speakers)\b/i),
      question('seating_food', 'Seating + food', 'Should this be seated, standing, bar service, or catered?', /\b(seated|standing|bar service|catered|food|drinks)\b/i),
      question('ticketing', 'Access', 'Is this free RSVP, ticketed, or private invite-only?', /\b(free|rsvp|ticketed|private|invite-only)\b/i),
    ],
    'pop-up': [
      ...shared,
      question('product', 'Product', 'What product, brand, or activation is the pop-up for?', /\b(product|brand|activation|retail|food|launch)\b/i),
      question('foot_traffic', 'Foot traffic', 'Do you want high foot traffic, appointment-only, or invite-only?', /\b(foot traffic|appointment|invite-only|walk-up|walkup|public)\b/i),
      question('permits_pos', 'Operations', 'Do you need permits, POS, staffing, storage, or load-in support?', /\b(permits?|pos|staffing|storage|load-?in|booth)\b/i),
    ],
    retreat: [
      ...shared,
      question('overnight_lodging', 'Lodging', 'Is this day-only, overnight, or multi-day with lodging?', /\b(day-only|overnight|multi-day|lodging|hotel|stay)\b/i),
      question('agenda', 'Agenda', 'What agenda should I plan: work sessions, meals, wellness, transport, or activities?', /\b(agenda|work sessions?|meals?|wellness|transport|activities|offsite)\b/i),
      question('privacy_transport', 'Logistics', 'Do you need private space, transportation, or accessibility requirements?', /\b(private space|transportation|transport|accessibility|shuttle|cars)\b/i),
    ],
  }

  if (normalized === 'afterparty') return questionBank['club night']
  if (normalized === 'gallery opening') return questionBank['launch party']
  if (normalized === 'tournament') return questionBank.conference
  if (normalized === 'party') return questionBank['day party']

  return questionBank[normalized] ?? shared
}

export function question(field: string, label: string, prompt: string, pattern: RegExp): EventSpecificQuestion {
  return {
    field,
    label,
    prompt,
    isAnswered: (conversationText) => pattern.test(conversationText),
  }
}

export function hasDateSignal(text: string): boolean {
  return /\b(today|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday|morning|afternoon|evening|night|am|pm|late|early|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm))\b/i.test(text)
}

export function detectLegacyDateSignal(text: string): string | null {
  const match = text.match(/\b(?:early|mid|late)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:today|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday)(?:\s+(?:morning|afternoon|evening|night))?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i)
  return match ? match[0].replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) : null
}

export function hasCitySignal(text: string): boolean {
  return /\b(sf|san francisco|oakland|berkeley|san jose|palo alto|marin|soma|mission|dogpatch|hayes valley|embarcadero|marina|fidi|castro|tenderloin|potrero|nob hill|north beach)\b/i.test(text)
}

export function hasTicketOrRsvpSignal(text: string): boolean {
  return /\b(ticketed|tickets?|rsvp|invite-only|free|paid|luma|eventbrite|posh)\b/i.test(text) || /https?:\/\//i.test(text)
}

export function hasVenueStatusSignal(text: string): boolean {
  return /\b(own venue|have (?:a )?venue|already have|need (?:a )?venue|find (?:a )?venue|use my venue|no venue|restaurant|bar|office|warehouse|space)\b/i.test(text)
}

export function readMockState(metadata?: PlanMessage['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return typeof metadata.state === 'string' ? metadata.state : null
}

export function shouldShowRecommendations(message: string): boolean {
  return /\b(show me|sounds good|okay|ok|yes|recommend|options|venues?|vendors?|book|booking|links?)\b/i.test(message)
}

export function buildMockRecommendations(plan: Plan): Array<Record<string, string | number | boolean | string[]>> {
  const neighborhood = plan.neighborhood ?? 'SoMa'
  const budget = plan.budget_cap_cents ?? 1000000
  const guestCount = plan.guest_count ?? 80
  const venueTarget = Math.max(250000, Math.round(budget * 0.5))
  const vendorTarget = Math.max(150000, Math.round(budget * 0.28))

  return [
    {
      name: `${neighborhood} Social Hall`,
      type: 'Venue',
      fit: 'Best fit',
      capacity: Math.max(guestCount + 40, 120),
      price_cents: venueTarget,
      action: 'Request hold',
      hold_duration_hours: 24,
      tags: ['AV included', 'Private bar', 'Host-friendly layout'],
      note: 'Agent would request availability and hold terms.',
    },
    {
      name: 'Bay Area Event Kitchen',
      type: 'Vendor',
      fit: 'Food package',
      capacity: guestCount,
      price_cents: vendorTarget,
      action: 'Email vendor',
      package_summary: 'Food package with staffing and dietary support',
      tags: ['Passed bites', 'Dietary support', 'Staffing available'],
      note: 'Agent would send the package request and collect terms.',
    },
    {
      name: 'External option from user link',
      type: 'External',
      fit: 'Bring-your-own',
      capacity: guestCount,
      price_cents: Math.max(100000, Math.round(budget * 0.2)),
      action: 'Open booking link',
      external_url: '',
      tags: ['User-provided', 'Needs verification', 'Approval required'],
      note: 'Agent can still track this even if it is outside the catalog.',
    },
  ]
}

export function detectMockEventType(message: string): string | null {
  const lower = message.toLowerCase()

  if (/\b(listening party|album party|music preview|release listen)\b/.test(lower)) return 'listening party'
  if (/\b(day party|brunch party|rooftop day|patio party|sunday party)\b/.test(lower)) return 'day party'
  if (/\b(pop-up|popup|brand pop-up|retail pop-up|food pop-up|activation)\b/.test(lower)) return 'pop-up'
  if (/\b(launch party|product launch|brand launch|release party)\b/.test(lower)) return 'launch party'
  if (/\b(birthday|milestone birthday)\b/.test(lower)) return 'birthday'
  if (/\b(afterparty|after party)\b/.test(lower)) return 'afterparty'
  if (/\b(house party|pregame)\b/.test(lower)) return 'house party'
  if (/\b(watch party|screening|sports watch|movie watch)\b/.test(lower)) return 'watch party'
  if (/\b(run club|running club|social run|5k meetup)\b/.test(lower)) return 'run club'
  if (/\b(tennis|tennis event|tennis tournament|tennis clinic|tennis social)\b/.test(lower)) return 'tennis event'
  if (lower.includes('retreat')) return 'retreat'
  if (/\b(giants|warriors|game outing|group tickets|seated together)\b/.test(lower)) return 'game outing'
  if (/\b(tournament|gaming tournament|esports tournament)\b/.test(lower)) return 'tournament'
  if (/\b(gallery opening|art opening|exhibition opening)\b/.test(lower)) return 'gallery opening'
  if (/\b(group dinner|founder dinner|private dinner|supper club|dinner)\b/.test(lower)) return 'dinner'
  if (/\b(networking mixer|founder mixer|mixer|happy hour|meetup)\b/.test(lower)) return 'mixer'
  if (/\b(panel|fireside chat|speaker panel|founder talk)\b/.test(lower)) return 'panel'
  if (/\b(workshop|class|skill session)\b/.test(lower)) return 'workshop'
  if (/\b(demo day|pitch night|showcase|graduation)\b/.test(lower)) return 'demo day'
  if (lower.includes('hackathon')) return 'hackathon'
  if (lower.includes('concert')) return 'concert'
  if (/\b(club night|nightlife event|dj night|dance party)\b/.test(lower)) return 'club night'
  if (/\b(fitness class|yoga|pilates|hiit|bootcamp)\b/.test(lower)) return 'fitness class'
  if (lower.includes('party') || lower.includes('afterparty') || lower.includes('gallery opening')) return 'party'
  if (lower.includes('conference') || lower.includes('summit') || lower.includes('tournament')) return 'conference'
  return null
}

export function detectMockGuestCount(message: string): number | null {
  const hyphenated = message.match(/\b(\d{1,5})-person\b/i)
  if (hyphenated) return Number(hyphenated[1])

  const audienceNouns =
    'founders|investors|guests|attendees|people|folks|members|participants|engineers|executives|creatives|artists|developers|designers|hackers|students|volunteers|employees|staff|speakers|athletes|runners|players|vendors|builders|fans|donors|person|pax'
  const match = message.match(new RegExp(`\\b(\\d{1,5})\\s*(?:tech\\s*)?(?:${audienceNouns})\\b`, 'i'))
  return match ? Number(match[1]) : null
}

export function detectMockBudgetCap(message: string): number | null {
  if (!/\b(budget|cap|spend|under|max|maximum|up to|total|all[-\s]?in)\b/i.test(message)) return null
  const money = message.match(/\$\s*(\d[\d,]*(?:\.\d+)?)(k|m)?/i)
  const shorthand = message.match(/\b(\d[\d,]*)\s*k\b/i)
  if (!money && !shorthand) return null

  const amountText = money?.[1] ?? shorthand?.[1]
  const amount = Number(amountText?.replaceAll(',', ''))
  if (!Number.isFinite(amount)) return null

  const suffix = money?.[2]?.toLowerCase() ?? (shorthand ? 'k' : '')
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const dollars = amount * multiplier
  return Number.isFinite(dollars) ? dollars * 100 : null
}

export function detectMockDateWindow(message: string): string | null {
  const monthDay = message.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (!monthDay) return null

  const monthToken = monthDay[0].split(/\s+/)[0].replace('.', '').toLowerCase()
  const monthMap: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  }
  const month = monthMap[monthToken]
  const day = Number(monthDay[1])

  if (!month || Number.isNaN(day)) return null
  return `2026-${month}-${String(day).padStart(2, '0')}`
}

export function detectMockTicketed(message: string, fallback: boolean): boolean {
  if (/\b(ticketed|paid|tickets?)\b/i.test(message)) return true
  if (/\b(rsvp|invite-only|free)\b/i.test(message)) return false
  return fallback
}

export function detectMockNeighborhood(message: string): string | null {
  const neighborhoods = ['SoMa', 'Mission', 'Dogpatch', 'Hayes Valley', 'Embarcadero', 'Marina', 'FiDi', 'Castro', 'Tenderloin', 'Potrero']
  return neighborhoods.find((neighborhood) => message.toLowerCase().includes(neighborhood.toLowerCase())) ?? null
}

export function detectMockCity(message: string): string | null {
  if (/\b(sf|san francisco)\b/i.test(message)) return 'San Francisco'
  if (/\boakland\b/i.test(message)) return 'Oakland'
  if (/\bberkeley\b/i.test(message)) return 'Berkeley'
  if (/\bsan jose\b/i.test(message)) return 'San Jose'
  if (/\bpalo alto\b/i.test(message)) return 'Palo Alto'
  if (/\bmarin\b/i.test(message)) return 'Marin'
  return null
}

export function formatMockCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
