import type { Plan, PlanMessage } from '@/lib/types'
import { classifyUnsupportedEventType } from '@/lib/planner/eventTaxonomy'

type MockAgentDraft = Pick<PlanMessage, 'role' | 'content' | 'message_type'> & {
  metadata: Record<string, unknown>
}

type OperationWindowKey = 'repeatable_small_event' | 'sf_tech_week_side_event' | 'lightweight_scope_only' | 'unsupported_high_touch'

interface OperationWindow {
  key: OperationWindowKey
  label: string
  posture: 'full_support' | 'constrained' | 'reject'
  summary: string
  mapsToEventType: string
}

interface MockIntakeContext {
  event_type: string
  event_type_detected: boolean
  operation_window: OperationWindow
  guest_count: number | null
  date: string | null
  date_window_start: string | null
  date_window_end: string | null
  date_confidence: 'high' | 'medium' | 'low' | null
  date_flexibility: 'exact' | 'flexible' | 'vague' | null
  time_preference: string | null
  area: string | null
  planning_archetype: string | null
  taxonomy_candidate: Record<string, unknown> | null
  budget_cents: number | null
  ticketing_model: string | null
  food_responsibility: string | null
  vendor_needs: string | null
  amenities: string | null
  venue_terms: string | null
  revenue_share: string | null
  action_permission: string | null
  must_haves: string[]
  dress_code: string | null
  duration: string | null
  conversation_text: string
}

interface MockAgentResponse {
  planPatch: Partial<Plan>
  messages: MockAgentDraft[]
}

interface DetectedDateContext {
  label: string
  start: string | null
  end: string | null
  confidence: 'high' | 'medium' | 'low'
  flexibility: 'exact' | 'flexible' | 'vague'
}

interface MockQuestionOption {
  label: string
  value: string
  description: string
}

interface MockStructuredQuestion {
  field: string
  label: string
  prompt: string
  instruction: string
  options: MockQuestionOption[]
  allow_other: boolean
  other_placeholder: string
}

interface MockNextQuestion {
  field: string
  label: string
  prompt: string
  options?: MockQuestionOption[]
  other_placeholder?: string
}

interface EventModelQuestion {
  field: string
  label: string
  prompt: string
  options: MockQuestionOption[]
  other_placeholder: string
  answered_patterns: RegExp[]
}

const EVENT_TYPES = [
  { label: 'Retreat', patterns: [/\bcorporate retreat\b/i, /\bretreat\b/i, /\bleadership retreat\b/i, /\bteam retreat\b/i, /\bfounder retreat\b/i, /\bteam[-\s]?offsite\b/i, /\boff[-\s]?site\b/i] },
  { label: 'Team offsite', patterns: [/\bteam[-\s]?offsite\b/i, /\boff[-\s]?site\b/i] },
  { label: 'Dinner', patterns: [/\b(group dinner|founder dinner|private dinner|supper club|tasting menu|dinner)\b/i] },
  { label: 'Mixer', patterns: [/\bnetworking\b/i, /\bmixer\b/i, /\bhappy hour\b/i, /\bfounder mixer\b/i, /\bmeetup\b/i] },
  { label: 'Launch Party', patterns: [/\bproduct launch\b/i, /\blaunch party\b/i, /\brelease party\b/i, /\bbrand launch\b/i] },
  { label: 'Conference', patterns: [/\bconference\b/i, /\bsummit\b/i, /\bspeaker day\b/i, /\bmini-conference\b/i] },
  { label: 'Day Party', patterns: [/\bday party\b/i, /\bbrunch party\b/i, /\brooftop day\b/i, /\bpatio party\b/i, /\bsunday party\b/i] },
  { label: 'Listening Party', patterns: [/\blistening party\b/i, /\balbum party\b/i, /\bmusic preview\b/i, /\brelease listen\b/i, /\bdj listening session\b/i] },
  { label: 'Birthday', patterns: [/\bbirthday\b/i, /\bmilestone birthday\b/i] },
  { label: 'House Party', patterns: [/\bhouse party\b/i, /\bkickback\b/i, /\bpregame\b/i, /\bcasual gathering\b/i, /\bapartment party\b/i] },
  { label: 'Concert', patterns: [/\bconcert\b/i, /\blive show\b/i, /\bshowcase\b/i, /\blive performance\b/i] },
  { label: 'Club Night', patterns: [/\bclub night\b/i, /\bnightlife\b/i, /\bdj night\b/i, /\bdance party\b/i, /\bafterdark\b/i] },
  { label: 'Run Club', patterns: [/\brun club\b/i, /\bsocial run\b/i, /\bcommunity run\b/i, /\b5k meetup\b/i, /\bwellness run\b/i] },
  { label: 'Fitness Class', patterns: [/\bfitness\b/i, /\byoga\b/i, /\bpilates\b/i, /\bhiit\b/i, /\bbootcamp\b/i, /\bwellness class\b/i] },
  { label: 'Workshop', patterns: [/\bworkshop\b/i, /\bclass\b/i, /\bcreator workshop\b/i, /\bskill session\b/i, /\bhands-on class\b/i] },
  { label: 'Panel', patterns: [/\bpanel\b/i, /\bfireside chat\b/i, /\bfounder talk\b/i, /\bdiscussion\b/i] },
  { label: 'Hackathon', patterns: [/\bhackathon\b/i, /\bbuild weekend\b/i, /\bcode sprint\b/i, /\bbuilder weekend\b/i] },
  { label: 'Demo Day', patterns: [/\bdemo day\b/i, /\bpitch night\b/i, /\binvestor demo\b/i, /\bgraduation showcase\b/i] },
  { label: 'Game Outing', patterns: [/\bgame outing\b/i, /\bgiants game\b/i, /\bwarriors game\b/i, /\bgroup tickets\b/i, /\bseated together\b/i] },
  { label: 'Watch Party', patterns: [/\bwatch party\b/i, /\bsports watch\b/i, /\bmovie watch\b/i, /\bscreening party\b/i] },
  { label: 'Pop-up', patterns: [/\bpop-?up\b/i, /\bbrand pop-up\b/i, /\bretail pop-up\b/i, /\bfood pop-up\b/i, /\bactivation\b/i] },
  { label: 'Wedding reception', patterns: [/\bwedding\b/i, /\breception\b/i] },
  { label: 'Graduation', patterns: [/\bgraduation\b/i, /\bgrad party\b/i] },
  { label: 'Holiday party', patterns: [/\bholiday party\b/i, /\bchristmas party\b/i, /\bend of year\b/i] },
  { label: 'Art/gallery show', patterns: [/\bart show\b/i, /\bgallery\b/i, /\bexhibition\b/i] },
  { label: 'Tennis event', patterns: [/\btennis\b/i, /\btennis event\b/i, /\btennis tournament\b/i, /\btennis clinic\b/i, /\btennis social\b/i] },
  { label: 'Food/wine tasting', patterns: [/\btasting\b/i, /\bwine\b/i, /\bfood event\b/i, /\bsupper club\b/i] },
  { label: 'Fundraiser/gala', patterns: [/\bfundraiser\b/i, /\bgala\b/i, /\bdonor\b/i] },
  { label: 'Music/live performance', patterns: [/\bmusic\b/i, /\bconcert\b/i, /\blive performance\b/i, /\blistening party\b/i] },
  { label: 'Film screening', patterns: [/\bfilm\b/i, /\bscreening\b/i, /\bmovie\b/i] },
  { label: 'Community meetup', patterns: [/\bcommunity meetup\b/i, /\bmeetup\b/i, /\bcommunity event\b/i] },
  { label: 'Kids party', patterns: [/\bkids party\b/i, /\bchildren\b/i, /\bfamily party\b/i] },
] as const

const AREA_OPTIONS = ['SOMA', 'Mission', 'Hayes Valley', 'Downtown Oakland']

const operationWindows = {
  repeatableSmallEvent: {
    key: 'repeatable_small_event',
    label: 'Small repeat event',
    posture: 'full_support',
    summary: 'Best fit for repeat organizers: simple venue fit, clear budget, light vendor stack, and profit tracking.',
    mapsToEventType: 'Mixer',
  },
  sfTechWeekSideEvent: {
    key: 'sf_tech_week_side_event',
    label: 'SF Tech Week side event',
    posture: 'full_support',
    summary: 'Best fit for one-off founder/community side events with tight timelines and practical venue/vendor needs.',
    mapsToEventType: 'Panel',
  },
  lightweightScopeOnly: {
    key: 'lightweight_scope_only',
    label: 'Lightweight scope only',
    posture: 'constrained',
    summary: '3rdSpace can help reduce this into a small side-event format, but not a full-service production.',
    mapsToEventType: 'Mixer',
  },
  unsupportedHighTouch: {
    key: 'unsupported_high_touch',
    label: 'Outside launch scope',
    posture: 'reject',
    summary: 'This needs high-touch planning that is outside the current small-organizer launch scope.',
    mapsToEventType: 'Event',
  },
} satisfies Record<string, OperationWindow>

const EVENT_MODEL_QUESTIONS = {
  dinner: [
    eventQuestion('dinner_cuisine', 'Cuisine', 'What cuisine or dining style should I optimize for?', [
      /\b(cuisine|italian|mexican|japanese|chinese|thai|mediterranean|steak|seafood|sushi|vegan|vegetarian|tasting|family-style|prix fixe|shared plates|family style|private chef)\b/i,
    ], [
      { label: 'Shared plates', value: 'Shared plates', description: 'Reliable for founder dinners and flexible dietary needs' },
      { label: 'Tasting menu', value: 'Tasting menu or prix fixe', description: 'Best for premium dinners with a clear per-person price' },
      { label: 'Restaurant menu', value: 'A la carte restaurant menu', description: 'Good when guests pay the venue directly' },
      { label: 'Vegetarian-friendly', value: 'Vegetarian-friendly', description: 'Prioritize inclusive menus and dietary support' },
    ], 'e.g. Thai, seafood, sushi, Mediterranean'),
    eventQuestion('dinner_room', 'Room type', 'Do you need a private room, semi-private area, or full buyout?', [
      /\b(private room|semi-private|buyout|chef'?s table|shared table|private dining)\b/i,
    ], [
      { label: 'Private room', value: 'Private room', description: 'Best for speeches, privacy, and controlled guest flow' },
      { label: 'Semi-private', value: 'Semi-private area', description: 'Often cheaper and easier to book' },
      { label: 'Full buyout', value: 'Full buyout', description: 'Best for brand control or larger dinners' },
      { label: 'Flexible', value: 'Flexible room type', description: 'Let the agent optimize for budget and availability' },
    ], 'e.g. chef’s table or patio'),
    eventQuestion('dinner_payment', 'Dinner payment model', 'Should the organizer prepay food, include dinner in the ticket, or let guests order and pay the venue directly?', [
      /\b(guests? pay|pay the venue directly|a la carte|cash bar|ticket includes food|dinner ticket|prix fixe|organizer prepays|hosted dinner|minimum spend)\b/i,
    ], [
      { label: 'Guests pay venue', value: 'Guests pay venue directly', description: 'Ticket, if any, covers access/community only' },
      { label: 'Ticket includes dinner', value: 'Ticket includes food', description: 'Model per-person food cost into ticket price' },
      { label: 'Organizer prepays', value: 'Organizer prepays food/beverage', description: 'Prix fixe, deposit, or minimum spend path' },
      { label: 'Minimum spend', value: 'Minimum spend', description: 'Venue earns through guaranteed food and beverage sales' },
    ], 'e.g. cash bar, hosted prix fixe, guests buy their own food'),
    eventQuestion('dinner_service', 'Service details', 'Any dietary constraints, seating needs, or beverage expectations?', [
      /\b(dietary|vegetarian|vegan|gluten-free|halal|kosher|wine pairing|cash bar|open bar|cocktails?|seated|family style|plated|shared plates)\b/i,
    ], [
      { label: 'Dietary-friendly', value: 'Dietary options needed', description: 'Vegetarian, vegan, gluten-free, halal, kosher, allergies' },
      { label: 'Wine / cocktails', value: 'Wine or cocktail service', description: 'Useful for restaurant/bar-side matching' },
      { label: 'Seated service', value: 'Seated service', description: 'Prioritize private dining and structured service' },
      { label: 'Casual order-at-bar', value: 'Casual order-at-bar', description: 'Lower commitment and easier guest-pay model' },
    ], 'e.g. vegetarian options, wine pairing, seated family style'),
  ],
  mixer: [
    eventQuestion('mixer_audience', 'Audience', 'Who is this mixer for?', [
      /\b(founders?|investors?|operators?|members?|creators?|students?|community|audience)\b/i,
    ], [
      { label: 'Founders + operators', value: 'Founders and operators', description: 'Startup-heavy networking with easy conversation flow' },
      { label: 'Founders + investors', value: 'Founders and investors', description: 'More polished venue, sponsor, and check-in expectations' },
      { label: 'Members / community', value: 'Members and community', description: 'Casual meetup with flexible RSVP assumptions' },
      { label: 'Invite-only guests', value: 'Invite-only guests', description: 'Prioritize privacy, controlled entry, and guest list' },
    ], 'e.g. designers, builders, creators'),
    eventQuestion('mixer_food_drink', 'Food + drink', 'What food and drink format should I plan around?', [
      /\b(drinks?|bar|bites|catering|food|sponsor-hosted|sponsored|check-?in|name tags?)\b/i,
    ], [
      { label: 'Drinks-only', value: 'Drinks-only', description: 'Bar package or minimum spend, lighter logistics' },
      { label: 'Light bites', value: 'Light bites and drinks', description: 'Safer for longer networking windows' },
      { label: 'Sponsor-hosted', value: 'Sponsor-hosted food and drinks', description: 'Adds sponsor visibility and capture needs' },
      { label: 'Check-in heavy', value: 'Check-in, badges, and sponsor capture', description: 'Prioritize front-door operations' },
    ], 'e.g. open bar, name tags, sponsor table'),
  ],
  'day party': [
    eventQuestion('day_party_vibe', 'Vibe', 'What kind of day party vibe should the venue support?', [
      /\b(rooftop|patio|brunch|pool|outdoor|indoor|dance|social|vibe)\b/i,
    ], [
      { label: 'Rooftop / patio', value: 'Rooftop or patio', description: 'Prioritize outdoor energy and photo moments' },
      { label: 'Brunch party', value: 'Brunch party', description: 'Food, daytime drinks, and social seating' },
      { label: 'Dance-forward', value: 'Dance-forward day party', description: 'DJ, sound limits, and security matter more' },
      { label: 'Chill social', value: 'Chill social day party', description: 'Lower production and easier venue fit' },
    ], 'e.g. poolside, patio, indoor/outdoor'),
    eventQuestion('day_party_alcohol', 'Alcohol + access', 'How should I handle alcohol and access?', [
      /\b(dj|alcohol|bar|byob|cocktails?|non-alcoholic|ticketed|free|invite-only|security|exclusive|buyout)\b/i,
    ], [
      { label: 'Venue bar package', value: 'Venue bar package', description: 'Simplest path for permits and operations' },
      { label: 'BYOB / hosted', value: 'BYOB or hosted alcohol', description: 'Needs venue rules and staffing check' },
      { label: 'Non-alcoholic', value: 'Non-alcoholic drinks', description: 'Mocktails, wellness, or sober-friendly format' },
      { label: 'Ticketed + security', value: 'Ticketed with security', description: 'Best for public or larger day parties' },
    ], 'e.g. beer-only, open bar, no alcohol'),
  ],
  'listening party': [
    eventQuestion('listening_music', 'Music focus', 'What artist, album, or release is the listening session centered on?', [
      /\b(artist|album|release|track|label|listening|music preview|dj)\b/i,
    ], [
      { label: 'Album release', value: 'Album release', description: 'Prioritize playback control and artist moments' },
      { label: 'DJ listening session', value: 'DJ listening session', description: 'Needs booth, sound, and transition control' },
      { label: 'Private preview', value: 'Private music preview', description: 'Controlled guest list and VIP handling' },
      { label: 'Fan event', value: 'Fan listening event', description: 'Higher capacity and merch/photo areas may matter' },
    ], 'e.g. artist name, release title'),
    eventQuestion('listening_av', 'Sound + guest list', 'How important are AV quality and guest-list control?', [
      /\b(sound|speakers?|av|playback|vip|guest list|press|artist guests?)\b/i,
    ], [
      { label: 'Premium sound', value: 'Premium sound required', description: 'Venue must support strong playback and low noise issues' },
      { label: 'VIP sections', value: 'VIP sections and controlled guest list', description: 'Plan for artist guests, press, and list control' },
      { label: 'Simple playback', value: 'Simple playback is fine', description: 'Lower cost, easier venue fit' },
      { label: 'Recording / livestream', value: 'Recording or livestream needed', description: 'Adds AV and consent requirements' },
    ], 'e.g. CDJs, surround sound, VIP area'),
  ],
  'launch party': [
    eventQuestion('launch_focus', 'Launch focus', 'What brand, product, or release is being launched?', [
      /\b(brand|product|release|startup|company|app|demo|press|launch)\b/i,
    ], [
      { label: 'Startup product', value: 'Startup product launch', description: 'Demo stations, AV, and founder remarks' },
      { label: 'Brand launch', value: 'Brand launch', description: 'Photo moments, press, and experiential details' },
      { label: 'Release party', value: 'Release party', description: 'Guest energy, music, and social flow' },
      { label: 'Press/VIP event', value: 'Press and VIP launch', description: 'Tighter guest list and premium venue fit' },
    ], 'e.g. app launch, fashion drop, product release'),
    eventQuestion('launch_needs', 'Demo + sponsor needs', 'What launch moments should I plan for?', [
      /\b(demo|press|vip|photography|photo|remarks|speech|presentation|sponsor|activation|booth)\b/i,
    ], [
      { label: 'Demo stations', value: 'Demo stations', description: 'Needs tables, power, wifi, and guest flow' },
      { label: 'Press + photographer', value: 'Press and photographer', description: 'Photo angles, step-and-repeat, and timing matter' },
      { label: 'Sponsor activation', value: 'Sponsor activation', description: 'Plan booth footprint and brand requirements' },
      { label: 'Speaking remarks', value: 'Speaking remarks and AV', description: 'Requires mics, sightlines, and run-of-show' },
    ], 'e.g. founder talk, media wall'),
  ],
  birthday: [
    eventQuestion('birthday_vibe', 'Birthday vibe', 'What kind of birthday format should I plan?', [
      /\b(dinner|dancing|cocktails?|day party|private room|theme|cake|decor|dj|music)\b/i,
    ], [
      { label: 'Birthday dinner', value: 'Birthday dinner', description: 'Restaurant/private room, menu, cake logistics' },
      { label: 'Cocktail party', value: 'Cocktail party', description: 'Venue or bar, music, drinks, guest list' },
      { label: 'Dancing / DJ', value: 'Dancing with DJ', description: 'Sound, dance area, late-night rules' },
      { label: 'Day party', value: 'Birthday day party', description: 'Outdoor/patio, daytime drinks, casual energy' },
    ], 'e.g. milestone, 30th, surprise party'),
  ],
  'house party': [
    eventQuestion('house_party_access', 'Access', 'Is this private, public RSVP, or ticketed?', [
      /\b(private|public|rsvp|ticketed|invite-only|byob|hosted|supplies|cleanup|speaker)\b/i,
    ], [
      { label: 'Private invite-only', value: 'Private invite-only', description: 'Keep it controlled and low-friction' },
      { label: 'Public RSVP', value: 'Public RSVP', description: 'Needs RSVP page, capacity, and entry plan' },
      { label: 'Ticketed', value: 'Ticketed house party', description: 'Needs risk checks, entry, and possible security' },
      { label: 'BYOB / self-hosted', value: 'BYOB or self-hosted', description: 'Focus on supplies, cleanup, and RSVP' },
    ], 'e.g. apartment, rooftop, backyard'),
  ],
  concert: [
    eventQuestion('concert_artist', 'Artist', 'Who is the artist or lineup, and are they confirmed?', [
      /\b(artist|lineup|band|performer|confirmed|talent|stage|sound|lighting|backline|ticket price)\b/i,
    ], [
      { label: 'Artist confirmed', value: 'Artist confirmed', description: 'Move toward venue, production, and ticketing' },
      { label: 'Need artist sourcing', value: 'Need artist sourcing', description: 'Adds talent outreach before venue lock' },
      { label: 'Showcase lineup', value: 'Showcase lineup', description: 'Multiple performers, set timing, green room needs' },
      { label: 'Ticketed concert', value: 'Ticketed concert', description: 'Model ticket price, capacity, and production cost' },
    ], 'e.g. artist name, genre, ticket price'),
  ],
  'club night': [
    eventQuestion('club_night_economics', 'Nightlife format', 'What genre and door/bar economics should I model?', [
      /\b(genre|dj|house|hip hop|dance|latin|afrobeats|door split|bar revenue|rev share|security|promo|guest list)\b/i,
    ], [
      { label: 'DJ night', value: 'DJ night with bar revenue share', description: 'Optimize for venue bar upside and promotion' },
      { label: 'Ticketed dance party', value: 'Ticketed dance party', description: 'Model door split, ticket price, and security' },
      { label: 'Guest-list night', value: 'Guest-list nightlife event', description: 'Prioritize RSVP/check-in and VIP tables' },
      { label: 'Promoter model', value: 'Promoter-supported club night', description: 'Adds promo, door split, and staffing assumptions' },
    ], 'e.g. house music, Afrobeats, 70/30 door split'),
  ],
  'run club': [
    eventQuestion('run_club_route', 'Route + pace', 'Do you have a route and pace, or should I suggest one?', [
      /\b(route|pace|miles|5k|jog|loop|start point|finish point|coffee|bar|brunch|waiver|permit|captain|water)\b/i,
    ], [
      { label: 'Suggest route', value: 'Suggest route and pace', description: 'Agent proposes start/end and post-run venue' },
      { label: 'Casual 5K', value: 'Casual 5K route', description: 'Easy social run with broad accessibility' },
      { label: 'Fast pace', value: 'Fast pace run', description: 'Plan captains, route clarity, and safety' },
      { label: 'Post-run hangout', value: 'Post-run coffee/bar/brunch', description: 'Find cafe/bar partner and group capacity' },
    ], 'e.g. 3 miles ending at a cafe'),
  ],
  'fitness class': [
    eventQuestion('fitness_class_needs', 'Instructor + gear', 'Do you already have an instructor and equipment?', [
      /\b(instructor|teacher|coach|trainer|mats?|weights?|towels?|gear|equipment|rain plan|indoor|outdoor|studio)\b/i,
    ], [
      { label: 'Have instructor', value: 'Instructor confirmed', description: 'Focus on venue/studio and equipment' },
      { label: 'Need instructor', value: 'Need instructor sourcing', description: 'Agent should include instructor outreach' },
      { label: 'Need mats/gear', value: 'Need mats and gear', description: 'Prioritize vendors or venue equipment' },
      { label: 'Outdoor with rain plan', value: 'Outdoor class with rain plan', description: 'Needs backup indoor option' },
    ], 'e.g. yoga mats, towels, trainer'),
  ],
  workshop: [
    eventQuestion('workshop_topic', 'Topic + outcome', 'What topic and attendee outcome should the workshop deliver?', [
      /\b(topic|outcome|learn|takeaway|curriculum|materials|supplies|tables|screens?|instructor|facilitator)\b/i,
    ], [
      { label: 'Hands-on making', value: 'Hands-on making workshop', description: 'Needs supplies, tables, cleanup, and instructor' },
      { label: 'Learning session', value: 'Learning / skill workshop', description: 'Needs screen, seating, and takeaways' },
      { label: 'Creator workshop', value: 'Creator workshop', description: 'Needs flexible space and content capture' },
      { label: 'Team workshop', value: 'Team workshop', description: 'Needs breakout space and facilitation' },
    ], 'e.g. pottery, AI tools, founder sales'),
  ],
  panel: [
    eventQuestion('panel_production', 'Speakers + AV', 'Who are the speakers and what AV/seating do you need?', [
      /\b(speakers?|moderator|panelists?|theater|seating|microphones?|mics?|recording|livestream|q&a|networking)\b/i,
    ], [
      { label: 'Speakers confirmed', value: 'Speakers and moderator confirmed', description: 'Move to venue, seating, and AV' },
      { label: 'Need speakers', value: 'Need speaker sourcing', description: 'Agent should help source speakers or moderator' },
      { label: 'Recording/livestream', value: 'Recording or livestream needed', description: 'Prioritize AV-first venues' },
      { label: 'Q&A + networking', value: 'Audience Q&A plus networking', description: 'Plan seating flip and post-panel flow' },
    ], 'e.g. 3 speakers, theater seating, 2 mics'),
  ],
  conference: [
    eventQuestion('conference_agenda', 'Agenda + operations', 'What agenda, tracks, sponsors, and ticketing operations should I plan for?', [
      /\b(agenda|tracks?|sessions?|keynote|breakout|sponsors?|booths?|activations?|ticket tiers?|check-?in|badges?|meals?|livestream)\b/i,
    ], [
      { label: 'Single-track summit', value: 'Single-track summit', description: 'Main stage, check-in, AV, and meals' },
      { label: 'Multi-track conference', value: 'Multi-track conference', description: 'Breakout rooms and more complex venue needs' },
      { label: 'Sponsor booths', value: 'Sponsor booths and activations', description: 'Plan booth footprint and partner ops' },
      { label: 'Ticketed conference', value: 'Ticket tiers, badges, and check-in', description: 'Needs ticketing, badges, and attendee ops' },
    ], 'e.g. two tracks, sponsor booths, lunch'),
  ],
  hackathon: [
    eventQuestion('hackathon_infrastructure', 'Infrastructure', 'What duration and infrastructure does the hackathon need?', [
      /\b(overnight|12-hour|24-hour|36-hour|48-hour|weekend|wifi|power|rooms|showers|meals?|snacks?|prizes?|judges?|demo day)\b/i,
    ], [
      { label: 'Day hackathon', value: 'Day hackathon', description: 'Wifi, power, food, judging, demo setup' },
      { label: 'Overnight / weekend', value: 'Overnight or weekend hackathon', description: 'Security, food schedule, showers/rest, staffing' },
      { label: 'Demo-day ending', value: 'Hackathon with demo day', description: 'Stage, judging, AV, and audience flow' },
      { label: 'Prizes + sponsors', value: 'Prizes, judges, and sponsors', description: 'Plan sponsor visibility and judging ops' },
    ], 'e.g. 48-hour, high-speed wifi, meals'),
  ],
  'demo day': [
    eventQuestion('demo_day_format', 'Pitch format', 'What pitch format and audience mix should I plan for?', [
      /\b(startups?|investors?|judging|run-of-show|stage demos?|expo|tables|awards|recording|livestream|catering|check-?in)\b/i,
    ], [
      { label: 'Stage demos', value: 'Stage demos', description: 'AV, seating, run-of-show, investor check-in' },
      { label: 'Expo tables', value: 'Expo tables', description: 'Booth/table layout and mingling flow' },
      { label: 'Judged pitches', value: 'Judged pitches and awards', description: 'Judging, timing, awards, and recording' },
      { label: 'Investor showcase', value: 'Investor showcase', description: 'Private guest list and premium check-in' },
    ], 'e.g. 12 startups, 80 investors, awards'),
  ],
  'game outing': [
    eventQuestion('game_outing_seats', 'Game + seats', 'Which game/date, group size, and seat budget should I target?', [
      /\b(giants|warriors|49ers|game|seats together|section|row|seat budget|per person|lower bowl|upper|club level|bleachers|email)\b/i,
    ], [
      { label: 'Seats together', value: 'Seats together required', description: 'Prioritize group ticket blocks' },
      { label: 'Best available', value: 'Best available seats', description: 'Optimize around budget and date' },
      { label: 'Premium section', value: 'Premium section or club level', description: 'Higher price, better hospitality' },
      { label: 'Pre/post drinks', value: 'Pre- or post-game drinks', description: 'Add restaurant/bar coordination' },
    ], 'e.g. Giants Friday game, under $90/person'),
  ],
  'watch party': [
    eventQuestion('watch_party_setup', 'Screen + seating', 'What screen, sound, seating, and food/drink setup do you need?', [
      /\b(screen|projector|tv|sound|audio|speakers|seated|standing|bar service|catered|food|drinks|free|rsvp|ticketed|private)\b/i,
    ], [
      { label: 'Big screen + sound', value: 'Big screen and strong sound', description: 'Sports finals, film, or high-attention viewing' },
      { label: 'Bar watch party', value: 'Bar service watch party', description: 'Venue/bar with food and drink revenue' },
      { label: 'Seated screening', value: 'Seated screening', description: 'Theater-style seating and controlled sound' },
      { label: 'Private invite-only', value: 'Private invite-only watch party', description: 'Smaller list, easier ops' },
    ], 'e.g. 100-inch screen, Warriors finals'),
  ],
  'pop-up': [
    eventQuestion('popup_ops', 'Product + operations', 'What product and pop-up operations should I plan for?', [
      /\b(product|brand|activation|retail|food|foot traffic|appointment|invite-only|walk-up|permits?|pos|staffing|storage|load-?in|booth)\b/i,
    ], [
      { label: 'Retail pop-up', value: 'Retail pop-up', description: 'Foot traffic, POS, storage, staffing' },
      { label: 'Food pop-up', value: 'Food pop-up', description: 'Permits, kitchen, service line, cleanup' },
      { label: 'Brand activation', value: 'Brand activation', description: 'Photo moment, booth footprint, staffing' },
      { label: 'Appointment-only', value: 'Appointment-only pop-up', description: 'Controlled traffic and invite list' },
    ], 'e.g. merch drop, chef pop-up, product demo'),
  ],
  retreat: [
    eventQuestion('retreat_logistics', 'Lodging + agenda', 'Is this day-only, overnight, or multi-day with meals, transport, and activities?', [
      /\b(day-only|overnight|multi-day|lodging|hotel|stay|meals?|wellness|transport|activities|private space|shuttle|accessibility|agenda)\b/i,
    ], [
      { label: 'Day-only offsite', value: 'Day-only retreat/offsite', description: 'Venue, meals, agenda, and facilitation' },
      { label: 'Overnight retreat', value: 'Overnight retreat', description: 'Lodging, meals, transport, and activities' },
      { label: 'Founder retreat', value: 'Founder retreat', description: 'Premium setting, privacy, meals, and work blocks' },
      { label: 'Team retreat', value: 'Team retreat with activities', description: 'Team sessions, transport, and group activities' },
    ], 'e.g. overnight in Napa with dinner and transport'),
  ],
} satisfies Record<string, EventModelQuestion[]>

/**
 * Generates deterministic mock planner responses for the frontend-only Agent Planner demo.
 *
 * The function asks one question per agent turn for five intake steps. On the
 * fifth user answer, it emits both a tailored recommendation message and a
 * confirmation card summary. It has no side effects and does not call any AI API.
 *
 * @param messages - Full thread including the latest user message.
 * @param userInput - Latest user-authored message.
 * @param existingPlan - Optional active mock plan used to preserve known context.
 * @returns Plan patch plus one or more mock agent message drafts.
 */
export function getMockAgentResponse(
  messages: PlanMessage[],
  userInput: string,
  existingPlan?: Plan | null
): MockAgentResponse {
  const priorAgentTurns = messages.filter((message) => message.role === 'agent').length
  const hasShownRecommendations = messages.some((message) => String(message.message_type) === 'recommendation')
  const context = buildMockIntakeContext(messages, userInput, existingPlan)
  const planPatch = buildPlanPatch(context)
  const nextQuestion = getNextMissingQuestion(context)

  if (context.operation_window.posture === 'reject') {
    return {
      planPatch,
      messages: [
        {
          role: 'agent',
          message_type: 'status_update',
          content: buildUnsupportedScopeResponse(context),
          metadata: {
            state: 'unsupported_scope',
            operation_window: context.operation_window,
            summary: buildSummaryMetadata(context),
          },
        },
      ],
    }
  }

  if (nextQuestion && !hasShownRecommendations) {
    const content = priorAgentTurns === 0
      ? buildInitialAcknowledgement(context, nextQuestion.prompt)
      : nextQuestion.prompt

    return {
      planPatch,
      messages: [
        {
          role: 'agent',
          message_type: 'confirmation_card',
          content,
          metadata: buildQuestionMetadata(context, nextQuestion, priorAgentTurns + 1),
        },
      ],
    }
  }

  if (!hasShownRecommendations) {
    return {
      planPatch: { ...planPatch, status: 'ready' },
      messages: [
        {
          role: 'agent',
          message_type: 'recommendation',
          content: `I have enough context to suggest venue paths for your ${context.event_type.toLowerCase()}. These are mock matches tuned to your headcount, area, budget, and must-haves.`,
          metadata: {
            state: 'recommendations_shown',
            recommendation_type: 'venue',
            operation_window: context.operation_window,
            recommendations: buildTailoredRecommendations(context),
            next_actions: ['Request hold', 'Contact vendor', 'External checkout'],
          },
        },
        {
          role: 'agent',
          message_type: 'confirmation_card',
          content: 'Here is the structured event summary I will use for booking and vendor outreach.',
          metadata: {
            state: 'event_summary',
            summary: {
              event_type: context.event_type,
              operation_window: context.operation_window,
              guest_count: context.guest_count,
              date: context.date,
              date_window_start: context.date_window_start,
              date_window_end: context.date_window_end,
              date_confidence: context.date_confidence,
              date_flexibility: context.date_flexibility,
              time_preference: context.time_preference,
              area: context.area,
              planning_archetype: context.planning_archetype,
              taxonomy_candidate: context.taxonomy_candidate,
              budget_cents: context.budget_cents,
              ticketing_model: context.ticketing_model,
              food_responsibility: context.food_responsibility,
              vendor_needs: context.vendor_needs,
              amenities: context.amenities,
              venue_terms: context.venue_terms,
              revenue_share: context.revenue_share,
              action_permission: context.action_permission,
              must_haves: context.must_haves,
              dress_code: context.dress_code,
              duration: context.duration,
            },
            confirmation_items: buildConfirmationItems(context),
          },
        },
        {
          role: 'agent',
          message_type: 'approval_request',
          content:
            'I can send this event brief to matched venues and vendors. Approve this outreach and I will route unclaimed listings through concierge.',
          metadata: buildMockOpportunityApprovalMetadata(context),
        },
      ],
    }
  }

  return {
    planPatch,
    messages: [
      {
        role: 'agent',
        message_type: 'status_update',
        content: buildOpenQaResponse(context, userInput),
        metadata: {
          state: 'open_qa',
          summary: {
            event_type: context.event_type,
            operation_window: context.operation_window,
            guest_count: context.guest_count,
            date: context.date,
            date_window_start: context.date_window_start,
            date_window_end: context.date_window_end,
            date_confidence: context.date_confidence,
            date_flexibility: context.date_flexibility,
            time_preference: context.time_preference,
            area: context.area,
            planning_archetype: context.planning_archetype,
            taxonomy_candidate: context.taxonomy_candidate,
            budget_cents: context.budget_cents,
            ticketing_model: context.ticketing_model,
            food_responsibility: context.food_responsibility,
            vendor_needs: context.vendor_needs,
            amenities: context.amenities,
            venue_terms: context.venue_terms,
            revenue_share: context.revenue_share,
            action_permission: context.action_permission,
            must_haves: context.must_haves,
            dress_code: context.dress_code,
            duration: context.duration,
          },
        },
      },
    ],
  }
}

function eventQuestion(
  field: string,
  label: string,
  prompt: string,
  answeredPatterns: RegExp[],
  options: MockQuestionOption[],
  otherPlaceholder: string
): EventModelQuestion {
  return {
    field: `event_${field}`,
    label,
    prompt,
    options,
    other_placeholder: otherPlaceholder,
    answered_patterns: [
      new RegExp(`\\b${escapeRegExp(label)}\\s*:`, 'i'),
      new RegExp(`\\b${escapeRegExp(field.replaceAll('_', ' '))}\\s*:`, 'i'),
      ...answeredPatterns,
    ],
  }
}

function getNextMissingQuestion(context: MockIntakeContext): MockNextQuestion | null {
  if (!context.event_type_detected) {
    return { field: 'event_type', label: 'Event type', prompt: 'What kind of event are you hosting?' }
  }
  if (context.operation_window.posture === 'constrained' && !hasAcceptedLightweightScope(context)) {
    return {
      field: 'operation_scope',
      label: 'Scope',
      prompt: buildConstrainedScopePrompt(context),
    }
  }
  if (!context.date) {
    return { field: 'date', label: 'Date window', prompt: "What's your target date or timeframe?" }
  }
  if (context.date_flexibility === 'flexible' && !context.time_preference) {
    return {
      field: 'time_preference',
      label: 'Time preference',
      prompt: isDinnerLike(context.event_type)
        ? 'For dinner, do you prefer a weekday evening or weekend evening/night?'
        : 'Do you prefer weekday evening, weekend daytime, weekend night, or are you flexible?',
    }
  }
  if (!context.area) {
    return {
      field: 'area',
      label: 'Area',
      prompt:
        'What area of the Bay Area works best — SOMA, Mission, Hayes Valley, Downtown Oakland, or are you flexible?',
    }
  }
  if (!context.budget_cents) {
    return {
      field: 'budget',
      label: 'Budget',
      prompt:
        "What's your all-in budget range? I’ll use it to keep venue deposits, vendor asks, and revenue model realistic.",
    }
  }
  const earlyEventQuestion = shouldAskEventModelBeforeGeneric(context)
    ? getNextEventModelQuestion(context)
    : null
  if (earlyEventQuestion) return earlyEventQuestion
  if (!context.ticketing_model) {
    return {
      field: 'ticketing_model',
      label: 'Ticketing model',
      prompt: 'Is this free RSVP, paid admission, a paid dinner ticket, invite-only, or connected to Luma/Eventbrite/Posh/Partiful?',
    }
  }
  if (!context.food_responsibility) {
    return {
      field: 'food_responsibility',
      label: 'Food + beverage',
      prompt: 'Does the ticket include food, or will guests pay the venue directly for what they order?',
    }
  }
  if (!context.vendor_needs) {
    return {
      field: 'vendor_needs',
      label: 'Vendor needs',
      prompt: 'Do you need vendors of any type, or are you handling everything yourself?',
    }
  }
  if (!context.amenities) {
    return {
      field: 'amenities',
      label: 'Amenities',
      prompt:
        'Do you need any amenities or setup requirements, like DJ hookup, extra setup time, TV screens, mics, courts, or check-in?',
    }
  }
  if (!context.venue_terms) {
    return {
      field: 'venue_terms',
      label: 'Venue terms',
      prompt: 'What venue deal structure should I optimize for: free space, minimum spend, flat rental, deposit hold, or flexible?',
    }
  }
  if (!context.revenue_share) {
    return {
      field: 'revenue_share',
      label: 'Revenue model',
      prompt: 'Do you care about the venue revenue-share model, or should I optimize for the simplest booking terms?',
    }
  }
  if (!context.action_permission) {
    return {
      field: 'action_permission',
      label: 'Agent action',
      prompt: 'When I find good fits, should I only show options, send the brief to venues, or request soft holds after approval?',
    }
  }

  return getNextEventModelQuestion(context)
}

function shouldAskEventModelBeforeGeneric(context: MockIntakeContext) {
  return isDinnerLike(context.event_type)
}

function getNextEventModelQuestion(context: MockIntakeContext): MockNextQuestion | null {
  const eventKey = getEventModelKey(context.event_type)
  const questions = eventKey ? EVENT_MODEL_QUESTIONS[eventKey] : undefined
  const nextQuestion = questions?.find((question) =>
    !question.answered_patterns.some((pattern) => pattern.test(context.conversation_text))
  )

  if (!nextQuestion) return null

  return {
    field: nextQuestion.field,
    label: nextQuestion.label,
    prompt: nextQuestion.prompt,
    options: nextQuestion.options,
    other_placeholder: nextQuestion.other_placeholder,
  }
}

function getEventModelKey(eventType: string) {
  const normalized = eventType.toLowerCase()

  if (normalized.includes('dinner') || normalized.includes('supper') || normalized.includes('tasting')) return 'dinner'
  if (normalized.includes('mixer') || normalized.includes('meetup') || normalized.includes('happy hour')) return 'mixer'
  if (normalized.includes('day party')) return 'day party'
  if (normalized.includes('listening')) return 'listening party'
  if (normalized.includes('launch')) return 'launch party'
  if (normalized.includes('birthday')) return 'birthday'
  if (normalized.includes('house')) return 'house party'
  if (normalized.includes('concert') || normalized.includes('performance')) return 'concert'
  if (normalized.includes('club') || normalized.includes('nightlife')) return 'club night'
  if (normalized.includes('run club') || normalized.includes('run ')) return 'run club'
  if (normalized.includes('fitness') || normalized.includes('yoga') || normalized.includes('pilates') || normalized.includes('bootcamp')) return 'fitness class'
  if (normalized.includes('workshop') || normalized.includes('class')) return 'workshop'
  if (normalized.includes('panel') || normalized.includes('fireside')) return 'panel'
  if (normalized.includes('conference') || normalized.includes('summit')) return 'conference'
  if (normalized.includes('hackathon')) return 'hackathon'
  if (normalized.includes('demo day') || normalized.includes('pitch')) return 'demo day'
  if (normalized.includes('game outing') || normalized.includes('game') || normalized.includes('group tickets')) return 'game outing'
  if (normalized.includes('watch party') || normalized.includes('screening')) return 'watch party'
  if (normalized.includes('pop-up') || normalized.includes('pop up') || normalized.includes('activation')) return 'pop-up'
  if (normalized.includes('retreat') || normalized.includes('offsite')) return 'retreat'

  return null
}

function buildMockIntakeContext(
  messages: PlanMessage[],
  userInput: string,
  existingPlan?: Plan | null
): MockIntakeContext {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
  const allInputs = [...userMessages]
  if (allInputs[allInputs.length - 1]?.trim() !== userInput.trim()) {
    allInputs.push(userInput)
  }
  const allText = allInputs.join('\n')
  const latestUserMessages = allInputs.length > 0 ? allInputs : [userInput]
  const detectedEventType = detectEventType(allText)
  const taxonomyCandidate = classifyUnsupportedEventType(allText, detectedEventType)
  const operationWindow = mapEventToOperationWindow(
    taxonomyCandidate?.raw_event_type ?? detectedEventType ?? existingPlan?.event_type ?? 'event',
    allText,
    taxonomyCandidate?.planning_archetype
  )
  const mustHaves = mergeUnique([
    ...detectMustHaves(allText),
    ...(taxonomyCandidate?.secondary_components ?? []),
    ...(taxonomyCandidate?.event_components.flatMap((component) => component.requirements) ?? []),
  ])
  const dateContext = detectDateContext(latestUserMessages.slice(1).join('\n')) ?? detectDateContext(allText)

  return {
    event_type: operationWindow.mapsToEventType || taxonomyCandidate?.raw_event_type || detectedEventType || existingPlan?.event_type || 'event',
    event_type_detected: Boolean(
      detectedEventType ??
        taxonomyCandidate?.raw_event_type ??
        (existingPlan?.event_type && existingPlan.event_type !== 'event')
    ),
    operation_window: operationWindow,
    guest_count: detectGuestCount(allText) ?? existingPlan?.guest_count ?? null,
    date: dateContext?.label ?? null,
    date_window_start: dateContext?.start ?? null,
    date_window_end: dateContext?.end ?? null,
    date_confidence: dateContext?.confidence ?? null,
    date_flexibility: dateContext?.flexibility ?? null,
    time_preference: detectTimePreference(allText),
    area: detectArea(latestUserMessages.slice(2).join('\n')) ?? existingPlan?.neighborhood ?? detectArea(allText),
    planning_archetype: taxonomyCandidate?.planning_archetype ?? null,
    taxonomy_candidate: taxonomyCandidate ? { ...taxonomyCandidate } : null,
    budget_cents: detectBudget(latestUserMessages.slice(3).join('\n')) ?? detectBudget(allText) ?? existingPlan?.budget_cap_cents ?? null,
    ticketing_model: detectTicketingModel(allText),
    food_responsibility: detectFoodResponsibility(allText),
    vendor_needs: detectVendorNeeds(allText),
    amenities: detectAmenities(allText),
    venue_terms: detectVenueTerms(allText),
    revenue_share: detectRevenueShare(allText),
    action_permission: detectActionPermission(allText),
    must_haves: mustHaves,
    dress_code: detectDressCode(allText),
    duration: detectDuration(allText),
    conversation_text: allText,
  }
}

function buildPlanPatch(context: MockIntakeContext): Partial<Plan> {
  return {
    event_type: context.event_type_detected ? context.event_type : null,
    guest_count: context.guest_count,
    neighborhood: context.area,
    budget_cap_cents: context.budget_cents,
    date_window_start: context.date_window_start ?? normalizeDateHint(context.date),
    date_window_end: context.date_window_end ?? context.date_window_start ?? normalizeDateHint(context.date),
    notes: buildPlanNotes(context),
    updated_at: new Date().toISOString(),
  }
}

function buildPlanNotes(context: MockIntakeContext) {
  const notes = [
    `Operation window: ${context.operation_window.label}`,
    context.vendor_needs ? `Vendor needs: ${context.vendor_needs}` : null,
    context.amenities ? `Amenities: ${context.amenities}` : null,
    context.ticketing_model ? `Ticketing model: ${context.ticketing_model}` : null,
    context.food_responsibility ? `Food responsibility: ${context.food_responsibility}` : null,
    context.venue_terms ? `Venue terms: ${context.venue_terms}` : null,
    context.revenue_share ? `Revenue model: ${context.revenue_share}` : null,
    context.action_permission ? `Agent action: ${context.action_permission}` : null,
    context.must_haves.length > 0 ? `Must-haves: ${context.must_haves.join(', ')}` : null,
  ].filter(Boolean)

  return notes.length > 0 ? notes.join('\n') : undefined
}

function buildInitialAcknowledgement(context: MockIntakeContext, prompt: string) {
  const eventLabel = context.event_type_detected ? context.event_type : 'an event'
  const headcountLabel = context.guest_count ? ` for ~${context.guest_count} people` : ''
  const dateLabel = context.date
    ? context.date_flexibility === 'exact'
      ? ` on ${context.date}`
      : ` ${formatDateWindowForSentence(context)}`
    : ''
  const urgencyNote = context.date_flexibility === 'flexible' && context.date_window_start && context.date_window_end
    ? ' Since that is soon, I will prioritize fast-confirming venues once the core details are set.'
    : ''
  const scopeNote = context.operation_window.posture === 'constrained'
    ? ` I am treating this as ${context.operation_window.label.toLowerCase()}, not a full-service production.`
    : context.operation_window.posture === 'full_support'
      ? ` This fits the ${context.operation_window.label.toLowerCase()} workflow.`
      : ''

  return `Got it — ${eventLabel}${headcountLabel}${dateLabel}.${scopeNote}${urgencyNote} ${prompt}`
}

function detectEventType(text: string): string | null {
  return EVENT_TYPES.find((eventType) => eventType.patterns.some((pattern) => pattern.test(text)))?.label ?? null
}

function mapEventToOperationWindow(
  eventType: string,
  fullText: string,
  planningArchetype?: string | null
): OperationWindow {
  const normalized = eventType.toLowerCase()
  const text = fullText.toLowerCase()
  const isTechWeekSideEvent = /\b(sf tech week|tech week|founder|startup|investor|operator|builder|demo|panel|launch|ai)\b/i.test(text)
  const isHighTouchUnsupported = /\b(wedding|wedding reception|kids party|children|family party)\b/i.test(normalized)
  const isHeavyButPlannable = /\b(conference|summit|retreat|offsite|corporate retreat|team offsite|multi-day|multi day|overnight)\b/i.test(normalized)
    || /\b(full conference|multi-track|multi track|overnight retreat|lodging|hotel rooms)\b/i.test(text)

  if (isHighTouchUnsupported) {
    return {
      ...operationWindows.unsupportedHighTouch,
      mapsToEventType: toSupportedEventType(eventType, planningArchetype, operationWindows.unsupportedHighTouch.mapsToEventType),
    }
  }

  if (isHeavyButPlannable) {
    return {
      ...operationWindows.lightweightScopeOnly,
      mapsToEventType: mapHeavyEventToLightweightType(eventType, text),
    }
  }

  if (isTechWeekSideEvent) {
    return {
      ...operationWindows.sfTechWeekSideEvent,
      mapsToEventType: toSupportedEventType(eventType, planningArchetype, operationWindows.sfTechWeekSideEvent.mapsToEventType),
    }
  }

  return {
    ...operationWindows.repeatableSmallEvent,
    mapsToEventType: toSupportedEventType(eventType, planningArchetype, operationWindows.repeatableSmallEvent.mapsToEventType),
  }
}

function toSupportedEventType(eventType: string, planningArchetype: string | null | undefined, fallback: string) {
  const eventKey = getEventModelKey(eventType)
  if (eventKey) return eventType

  const normalized = eventType.toLowerCase()
  if (/\b(corporate retreat|retreat|team[-\s]?offsite|off[-\s]?site)\b/i.test(normalized)) return 'Retreat'
  if (/\b(conference|summit)\b/i.test(normalized)) return 'Conference'
  if (/\btennis|pickleball|run|running|fitness|wellness|yoga|pilates|sports?\b/i.test(normalized)) return 'Fitness Class'
  if (/\bfood|dinner|supper|tasting|wine|coffee|brunch|mocktails?|cocktails?\b/i.test(normalized)) return 'Dinner'
  if (/\bmusic|listening|album|dj|karaoke|concert|band|performance\b/i.test(normalized)) return 'Listening Party'
  if (/\bmarket|pop-up|popup|activation|swap|retail\b/i.test(normalized)) return 'Pop-up'
  if (/\bpanel|talk|demo|startup|founder|investor|professional|pitch\b/i.test(normalized)) return 'Panel'
  if (/\bworkshop|class|clinic|lesson|education|training\b/i.test(normalized)) return 'Workshop'
  if (/\bgame|watch|screening|movie|film|trivia|tournament|bracket|league\b/i.test(normalized)) return 'Watch Party'
  if (planningArchetype === 'sports' || planningArchetype === 'wellness') return 'Fitness Class'
  if (planningArchetype === 'food') return 'Dinner'
  if (planningArchetype === 'music' || planningArchetype === 'performance') return 'Listening Party'
  if (planningArchetype === 'market') return 'Pop-up'
  if (planningArchetype === 'education') return 'Workshop'
  if (planningArchetype === 'professional') return 'Panel'
  if (planningArchetype === 'competitive_social' || planningArchetype === 'social') return 'Mixer'

  return fallback
}

function mapHeavyEventToLightweightType(eventType: string, text: string) {
  if (/\bretreat|off[-\s]?site\b/i.test(eventType) || /\bretreat|off[-\s]?site\b/i.test(text)) return 'Retreat'
  if (/\bhackathon\b/i.test(eventType) || /\bhackathon\b/i.test(text)) return 'Hackathon'
  if (/\b(conference|summit)\b/i.test(eventType) || /\b(conference|summit)\b/i.test(text)) return 'Conference'
  if (/\bdemo\b/i.test(eventType) || /\bdemo\b/i.test(text)) return 'Demo Day'
  if (/\bpanel|speaker|fireside\b/i.test(text)) return 'Panel'
  return 'Mixer'
}

function hasAcceptedLightweightScope(context: MockIntakeContext) {
  return /\b(lightweight|small|side event|side-event|one-off|one off|simple|mvp|yes|that works|ok|okay|fine)\b/i.test(context.conversation_text)
}

function buildConstrainedScopePrompt(context: MockIntakeContext) {
  return `This sounds like ${context.operation_window.label.toLowerCase()}. 3rdSpace is optimized for small one-off events, not full-service conferences, retreats, or multi-day productions. Should I scope this as a smaller ${context.operation_window.mapsToEventType.toLowerCase()} that we can launch and track?`
}

function buildUnsupportedScopeResponse(context: MockIntakeContext) {
  return `This is outside the current 3rdSpace launch scope. ${context.operation_window.summary} I can help reframe it as a small community event, but I should not create booking recommendations for the original format yet.`
}

function buildSummaryMetadata(context: MockIntakeContext) {
  return {
    event_type: context.event_type,
    operation_window: context.operation_window,
    guest_count: context.guest_count,
    date: context.date,
    area: context.area,
    budget_cents: context.budget_cents,
    must_haves: context.must_haves,
  }
}

function detectGuestCount(text: string): number | null {
  const audienceNouns =
    'founders|investors|guests|attendees|people|folks|members|participants|engineers|executives|creatives|artists|developers|designers|hackers|students|volunteers|employees|staff|speakers|athletes|runners|players|vendors|builders|donors|kids|families|person|pax'
  const hyphenated = text.match(/\b(\d{1,5})-person\b/i)
  if (hyphenated) return Number(hyphenated[1])

  const rangeMatch = text.match(new RegExp(`\\b(\\d{1,5})\\s*(?:-|to)\\s*(\\d{1,5})\\s*(?:tech\\s*)?(?:${audienceNouns})\\b`, 'i'))
  if (rangeMatch) return Math.max(Number(rangeMatch[1]), Number(rangeMatch[2]))

  const nearNoun = text.match(new RegExp(`\\b(\\d{1,5})\\s*(?:tech\\s*)?(?:${audienceNouns})\\b`, 'i'))
  if (nearNoun) return Number(nearNoun[1])

  const nounNearNumber = text.match(new RegExp(`\\b(?:${audienceNouns})\\s*(?:of|around|about|for)?\\s*(\\d{1,5})\\b`, 'i'))
  return nounNearNumber ? Number(nounNearNumber[1]) : null
}

function detectDateContext(text: string): DetectedDateContext | null {
  const relativeWindow = detectRelativeDateWindow(text)
  if (relativeWindow) return relativeWindow

  const exact = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (exact) {
    const start = toLocalIsoDate(new Date(currentPlanningYear(), monthNumber(exact[1]) - 1, Number(exact[2])))
    return {
      label: `${monthDisplayName(exact[1])} ${formatOrdinal(Number(exact[2]))}`,
      start,
      end: start,
      confidence: 'high',
      flexibility: 'exact',
    }
  }

  const monthWindow = text.match(/\b(early|mid|late)([\s-]+)(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
  if (monthWindow) {
    const separator = monthWindow[2].includes('-') ? '-' : ' '
    const [startDay, endDay] = monthBandDays(monthWindow[1], monthNumber(monthWindow[3]))
    return {
      label: `${toTitleCase(monthWindow[1])}${separator}${monthDisplayName(monthWindow[3])}`,
      start: toLocalIsoDate(new Date(currentPlanningYear(), monthNumber(monthWindow[3]) - 1, startDay)),
      end: toLocalIsoDate(new Date(currentPlanningYear(), monthNumber(monthWindow[3]) - 1, endDay)),
      confidence: 'medium',
      flexibility: 'flexible',
    }
  }

  const ordinalWeekend = text.match(/\b(first|second|third|last)\s+weekend\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
  if (ordinalWeekend) {
    const [start, end] = weekendWindowForMonth(ordinalWeekend[1], monthNumber(ordinalWeekend[2]))
    return {
      label: `${toTitleCase(ordinalWeekend[1])} weekend of ${monthDisplayName(ordinalWeekend[2])}`,
      start,
      end,
      confidence: 'medium',
      flexibility: 'flexible',
    }
  }

  const monthOnly = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
  if (monthOnly) {
    const month = monthNumber(monthOnly[1])
    return {
      label: monthDisplayName(monthOnly[1]),
      start: toLocalIsoDate(new Date(currentPlanningYear(), month - 1, 1)),
      end: toLocalIsoDate(new Date(currentPlanningYear(), month, 0)),
      confidence: 'low',
      flexibility: 'vague',
    }
  }

  const phrase = text.match(/\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|quarter|fall|winter|spring|summer)\b/i)
  if (phrase) {
    return {
      label: toTitleCase(phrase[0]),
      start: null,
      end: null,
      confidence: 'low',
      flexibility: 'vague',
    }
  }

  const weekday = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(morning|afternoon|evening|night)?\b/i)
  if (weekday) {
    return {
      label: toTitleCase(weekday[0]),
      start: null,
      end: null,
      confidence: 'low',
      flexibility: 'vague',
    }
  }

  return null
}

function detectArea(text: string): string | null {
  const canonicalAreas = [
    'Downtown San Francisco',
    'Downtown Oakland',
    'Downtown SF',
    'Jack London Square',
    'Uptown Oakland',
    'East Oakland',
    'Pacific Heights',
    'Financial District',
    'Potrero Hill',
    'Bernal Heights',
    'Inner Sunset',
    'Outer Sunset',
    'Inner Richmond',
    'Outer Richmond',
    'Napa Valley',
    'Wine Country',
    'South Beach',
    'Union Square',
    'Civic Center',
    'Mid-Market',
    'North Beach',
    'Nob Hill',
    'Pac Heights',
    'San Francisco',
    'South Bay',
    'Redwood City',
    'Foster City',
    'San Mateo',
    'Burlingame',
    'Menlo Park',
    'Palo Alto',
    'Mountain View',
    'Sunnyvale',
    'Santa Clara',
    'San Jose',
    'Mill Valley',
    'Sausalito',
    'Emeryville',
    'Petaluma',
    'Tiburon',
    'Alameda',
    'Berkeley',
    'Oakland',
    'Sonoma',
    'Marin',
    'Napa',
    'Peninsula',
    'Caltrain',
    'Chinatown',
    'Downtown',
    'Tenderloin',
    'Dogpatch',
    'Excelsior',
    'Richmond',
    'Sunset',
    'Fillmore',
    'Presidio',
    'Embarcadero',
    'Hayes Valley',
    'Mission',
    'Castro',
    'Marina',
    'FiDi',
    'SOMA',
    'Mission',
    'SF',
    'the city',
  ]
  if (/\b(?:area|location|neighborhood|city|where)\b[^.!?]*\bflexible\b/i.test(text) || /\bflexible\b[^.!?]*\b(?:area|location|neighborhood|city)\b/i.test(text)) return 'Flexible'
  const downtownCity = text.match(/\bdowntown\s+(sf|san francisco|oakland)\b/i)
  if (downtownCity) {
    const city = downtownCity[1].toLowerCase()
    if (city === 'sf') return 'Downtown SF'
    if (city === 'san francisco') return 'Downtown San Francisco'
    return 'Downtown Oakland'
  }

  return canonicalAreas.find((area) => new RegExp(`\\b${escapeRegExp(area)}\\b`, 'i').test(text)) ?? null
}

function detectTimePreference(text: string): string | null {
  if (/\bweekday\s+(evening|night|afternoon|morning)s?\b/i.test(text)) return toTitleCase(text.match(/\bweekday\s+(evening|night|afternoon|morning)s?\b/i)?.[0] ?? '')
  if (/\bweekend\s+(daytime|day|afternoon|morning)s?\b/i.test(text)) return 'Weekend daytime'
  if (/\bweekend\s+(night|evening)s?\b/i.test(text)) return 'Weekend night'
  if (/\b(thursday|friday|saturday|sunday)\s*(?:-|to)\s*(saturday|sunday)\b/i.test(text)) return toTitleCase(text.match(/\b(thursday|friday|saturday|sunday)\s*(?:-|to)\s*(saturday|sunday)\b/i)?.[0] ?? '')
  if (/\b(?:time|date|window|day)\s+(?:is\s+)?flexible\b/i.test(text) || /\bflexible\s+(?:time|date|window|day)\b/i.test(text)) return 'Flexible'
  if (/\bspecific date\b/i.test(text)) return 'Specific date'
  return null
}

function detectRelativeDateWindow(text: string): DetectedDateContext | null {
  if (/\bnext\s+weekend\b/i.test(text)) return buildWeekendDateWindow('Next weekend', 1)
  if (/\bthis\s+weekend\b/i.test(text)) return buildWeekendDateWindow('This weekend', 0)

  const nextWeeks = text.match(/\b(?:in\s+)?(?:the\s+)?next\s+(couple|few|one|two|three|four|\d+)\s+weeks?\b/i)
    ?? text.match(/\bwithin\s+(?:the\s+)?(?:next\s+)?(couple|few|one|two|three|four|\d+)\s+weeks?\b/i)
  if (nextWeeks) {
    const weeks = relativeNumber(nextWeeks[1], 2)
    return buildRollingWindow(weeks * 7)
  }

  const nextDays = text.match(/\b(?:in\s+)?(?:the\s+)?next\s+(couple|few|one|two|three|four|\d+)\s+days?\b/i)
    ?? text.match(/\bwithin\s+(?:the\s+)?(?:next\s+)?(couple|few|one|two|three|four|\d+)\s+days?\b/i)
  if (nextDays) {
    return buildRollingWindow(relativeNumber(nextDays[1], 3))
  }

  if (/\bnext\s+week\b/i.test(text)) return buildRollingWindow(7)
  if (/\bnext\s+two\s+weeks?\b/i.test(text)) return buildRollingWindow(14)
  if (/\bnext\s+month\b/i.test(text)) return buildRollingWindow(30)

  return null
}

function buildWeekendDateWindow(label: string, weekOffset: number): DetectedDateContext {
  const today = startOfLocalDay(new Date())
  const daysUntilSaturday = (6 - today.getDay() + 7) % 7 || 7
  const saturday = addDays(today, daysUntilSaturday + weekOffset * 7)
  const sunday = addDays(saturday, 1)

  return {
    label,
    start: toLocalIsoDate(saturday),
    end: toLocalIsoDate(sunday),
    confidence: 'medium',
    flexibility: 'flexible',
  }
}

function buildRollingWindow(days: number): DetectedDateContext {
  const today = startOfLocalDay(new Date())
  const start = addDays(today, 1)
  const end = addDays(today, days)

  return {
    label: `${formatMonthDay(start)}-${formatMonthDay(end)}`,
    start: toLocalIsoDate(start),
    end: toLocalIsoDate(end),
    confidence: 'medium',
    flexibility: 'flexible',
  }
}

function detectBudget(text: string): number | null {
  const thousands = text.match(/\$?([\d,]+\.?\d*)\s*k\b/i)
  if (thousands) return parseBudgetAmount(thousands[1], 1_000)

  const millions = text.match(/\$?([\d,]+\.?\d*)\s*m\b/i)
  if (millions) return parseBudgetAmount(millions[1], 1_000_000)

  const plain = text.match(/\$([\d,]+)/) ?? (/\b(budget|cap|spend|under|around)\b/i.test(text) ? text.match(/\b([\d,]+)\b/) : null)
  return plain ? parseBudgetAmount(plain[1], 1) : null
}

function detectTicketingModel(text: string): string | null {
  const explicit = text.match(/\b(?:ticketing model|ticketing|tickets?|rsvp)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(luma|eventbrite|posh|partiful)\b/i.test(text)) return 'External ticketing platform'
  if (/\b(paid dinner ticket|ticket includes food|food included|dinner ticket)\b/i.test(text)) return 'Paid dinner ticket'
  if (/\b(sell tickets|paid admission|ticketed|paid ticket|charge admission|door price|ticket price)\b/i.test(text)) {
    return 'Paid admission'
  }
  if (/\b(free rsvp|free event|rsvp only|free to attend)\b/i.test(text)) return 'Free RSVP'
  if (/\b(invite-only|invite only|private guest list|no tickets?)\b/i.test(text)) return 'Invite-only / no ticketing'

  return null
}

function detectFoodResponsibility(text: string): string | null {
  const explicit = text.match(/\b(?:food responsibility|food model|food \+ beverage|food and beverage|food\/beverage|f&b)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(guests? pay|pay the venue directly|buy their own|order their own|cash bar|guest-paid|guest paid|a la carte)\b/i.test(text)) {
    return 'Guests pay venue directly'
  }
  if (/\b(ticket includes food|food included|dinner ticket|prix fixe included|meal included)\b/i.test(text)) {
    return 'Ticket includes food'
  }
  if (/\b(organizer pays|prepay|pre-paid|prepaid|prix fixe|fixed menu|hosted food|hosted dinner|hosted bar|open bar)\b/i.test(text)) {
    return 'Organizer prepays food/beverage'
  }
  if (/\b(sponsor covers|sponsor-paid|sponsored food|sponsored drinks|partner covers)\b/i.test(text)) {
    return 'Sponsor covers food/beverage'
  }
  if (/\b(no food|no drinks|no f&b|no food or drinks|venue only)\b/i.test(text)) return 'No food/beverage needed'

  return null
}

function detectVendorNeeds(text: string): string | null {
  const explicit = text.match(/\bvendor needs?\s*:\s*([^.!?\n]+)/i)
    ?? text.match(/\bvendors?\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(no vendors?|none|handling everything ourselves?|i'?ll handle|self[-\s]?serve)\b/i.test(text)) {
    return 'No vendors needed'
  }

  const vendorSignals = [
    'DJ / music',
    'Catering / food',
    'Bar / beverage',
    'Photographer',
    'Videographer',
    'Security',
    'Check-in staff',
    'AV / production',
    'Coach / instructor',
    'Decorator',
    'Valet',
  ]

  const matches = vendorSignals.filter((signal) => {
    const pattern = signal
      .replace(' / ', '|')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace('\\|', '|')
    return new RegExp(`\\b(?:${pattern})s?\\b`, 'i').test(text)
  })

  return matches.length > 0 ? matches.join(', ') : null
}

function detectVenueTerms(text: string): string | null {
  const explicit = text.match(/\b(?:venue terms?|deal structure|booking terms?)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(free space|free venue|no room fee|donated space|comped space)\b/i.test(text)) return 'Free space'
  if (/\b(minimum spend|min spend|food and beverage minimum|f&b minimum)\b/i.test(text)) return 'Minimum spend'
  if (/\b(flat rental|rental fee|room rental|flat fee)\b/i.test(text)) return 'Flat rental'
  if (/\b(deposit hold|refundable hold|soft hold|hold fee|deposit only)\b/i.test(text)) return 'Deposit / refundable hold'
  if (/\b(flexible terms|flexible deal|whatever works|optimize terms)\b/i.test(text)) return 'Flexible terms'

  return null
}

function detectAmenities(text: string): string | null {
  const explicit = text.match(/\b(?:amenities|setup requirements?|setup needs?)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  const amenities = [
    'DJ hookup',
    'extra setup time',
    'TV screens',
    'projector',
    'microphones',
    'sound system',
    'check-in table',
    'tables',
    'chairs',
    'court access',
    'equipment rental',
    'storage',
    'green room',
    'parking',
    'wifi',
    'kitchen',
  ]
  const matches = amenities.filter((amenity) => new RegExp(`\\b${escapeRegExp(amenity)}\\b`, 'i').test(text))

  if (/\b(no amenities?|none|basic setup|standard setup|nothing special)\b/i.test(text)) {
    return 'Standard setup is fine'
  }

  return matches.length > 0 ? matches.join(', ') : null
}

function detectActionPermission(text: string): string | null {
  const explicit = text.match(/\b(?:agent action|action permission|next action|approval)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(show options only|only show|recommendations only|do not contact|don't contact)\b/i.test(text)) return 'Show options only'
  if (/\b(send (?:the )?(?:brief|event) to venues|send to venues|contact venues|outreach)\b/i.test(text)) return 'Send brief after approval'
  if (/\b(request holds?|soft holds?|place holds?|hold request)\b/i.test(text)) return 'Request soft holds after approval'
  if (/\b(concierge|human review|check first|manual review)\b/i.test(text)) return 'Concierge review first'

  return null
}

function detectRevenueShare(text: string): string | null {
  const explicit = text.match(/\b(?:revenue share|revenue model|rev share|economics)\s*:\s*([^.!?\n]+)/i)
  if (explicit) return normalizeAnswerValue(explicit[1])

  if (/\b(no revenue share|no rev share|flat rental|simple booking terms|simplest booking terms|no kickback)\b/i.test(text)) {
    return 'No revenue share'
  }
  if (/\b(bar revenue share|bar rev share|bar split|bar kickback)\b/i.test(text)) return 'Bar revenue share'
  if (/\b(ticket revenue share|ticket rev share|ticket split|door split)\b/i.test(text)) return 'Ticket revenue share'
  if (/\b(per[-\s]?head kickback|per attendee|per confirmed attendee)\b/i.test(text)) return 'Per-head kickback'
  if (/\b(not sure|recommend|optimize|best model|open to)\b/i.test(text) && /\b(revenue|economics|terms|kickback|share)\b/i.test(text)) {
    return 'Recommend best model'
  }

  return null
}

function normalizeAnswerValue(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function parseBudgetAmount(value: string, multiplier: number) {
  const amount = Number(value.replaceAll(',', ''))
  if (!Number.isFinite(amount)) return null
  return Math.round(amount * multiplier * 100)
}

function detectMustHaves(text: string): string[] {
  const matches: string[] = []
  const needList = text.match(/\b(?:need|needs|must have|must-have|must haves|including)\s+([^.!?\n]+)/i)
  if (needList) {
    matches.push(
      ...needList[1]
        .split(/\s*(?:,|&|\band\b)\s*/i)
        .map((item) => normalizeMustHaveItem(item))
        .filter((item) => item.length > 0)
    )
  }

  const knownPhrases = [
    'black tie',
    'semi-formal',
    'formal',
    'casual',
    'cocktail attire',
    'business casual',
    'outdoor space',
    'open floor plan',
    'wheelchair accessible',
    'good wifi',
    'sound system',
    'green room',
    'live jazz band',
    'live band',
    'live music',
    'team building',
    'coat check',
    'hotel rooms',
    'AV/projector',
    'projector',
    'catering included',
    'accommodations',
    'videographer',
    'photographer',
    'activities',
    'networking',
    'workshops',
    'catering',
    'parking',
    'outdoor',
    'rooftop',
    'security',
    'kitchen',
    'industrial',
    'intimate',
    'lodging',
    'stage',
    'sound',
    'wifi',
    'bar',
    'DJ',
    'valet',
    'garden',
    'historic',
    'kid-friendly',
    'private room',
    'private dining',
    'semi-private',
    'full buyout',
    'chef’s table',
    "chef's table",
    'tasting menu',
    'prix fixe',
    'shared plates',
    'family style',
    'plated dinner',
    'dietary options',
    'vegetarian-friendly',
    'wine pairing',
    'cash bar',
    'open bar',
    'bar package',
    'tennis court',
    'tennis courts',
    'court rental',
    'mocktails',
    'zero-proof drinks',
    'post-run meetup',
    'coach',
    'instructor',
    'rackets',
  ]

  for (const phrase of knownPhrases) {
    if (new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i').test(text)) {
      matches.push(phrase.toLowerCase() === 'dj' ? 'DJ' : phrase.toLowerCase())
    }
  }

  return mergeUnique(matches)
}

function normalizeMustHaveItem(value: string) {
  let item = cleanRequirementItem(value)
  const trailingDressCode = item.match(/\s+(black tie|semi-formal|formal|casual|cocktail attire|business casual)$/i)
  if (trailingDressCode) {
    item = item.slice(0, trailingDressCode.index).trim()
  }

  return item
}

function cleanRequirementItem(value: string) {
  return value
    .split(/\n/)[0]
    .replace(/\b(?:Ticketing model|Ticketing|Food \+ beverage|Food responsibility|Vendor needs?|Amenities|Venue terms?|Revenue model|Agent action)\s*:.*$/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(?:a|the|some)\s+/i, '')
    .replace(/[.;:,-]+$/g, '')
    .trim()
}

function mergeUnique(items: string[]) {
  return Array.from(new Set(items.map(cleanRequirementItem).filter(Boolean)))
}

function detectDressCode(text: string): string | null {
  const match = text.match(/\b(black tie|semi-formal|formal|casual|cocktail attire|business casual)\b/i)
  return match ? match[1].toLowerCase() : null
}

function detectDuration(text: string): string | null {
  const numeric = text.match(/\b(\d+)-(hour|day)\b/i)
  if (numeric) {
    const value = Number(numeric[1])
    return numeric[2].toLowerCase() === 'hour'
      ? `${value} ${value === 1 ? 'hour' : 'hours'}`
      : `${value} ${value === 1 ? 'day' : 'days'}`
  }

  if (/\bhalf-day\b/i.test(text)) return '0.5 days'
  if (/\bfull-day\b/i.test(text)) return '1 day'
  if (/\bweekend\b/i.test(text)) return '2 days'
  return null
}

function buildQuestionMetadata(context: MockIntakeContext, nextQuestion: MockNextQuestion, turn: number) {
  return {
    state: 'intake',
    turn,
    missing_fields: [nextQuestion.field],
    confirmation_items: buildConfirmationItems(context),
    questions: [buildStructuredQuestion(context, nextQuestion)],
  }
}

function buildStructuredQuestion(context: MockIntakeContext, nextQuestion: MockNextQuestion): MockStructuredQuestion {
  const { field } = nextQuestion
  const questionPrompt = nextQuestion.prompt ?? 'What should I know before I keep planning?'

  if (nextQuestion.options) {
    return {
      field,
      label: nextQuestion.label,
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: nextQuestion.options,
      allow_other: true,
      other_placeholder: nextQuestion.other_placeholder ?? 'Add a custom answer',
    }
  }

  if (field === 'event_type') {
    return {
      field,
      label: 'Event type',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Social / mixer',
          value: 'Networking mixer',
          description: 'Founder mixer, meetup, happy hour, community gathering',
        },
        {
          label: 'Sports / fitness',
          value: 'Tennis event',
          description: 'Tennis, run club, wellness class, tournament, active social',
        },
        {
          label: 'Launch / brand',
          value: 'Product launch',
          description: 'Product launch, pop-up, brand activation, press moment',
        },
        {
          label: 'Workshop / learning',
          value: 'Workshop/class',
          description: 'Class, panel, hackathon, summit, demo day',
        },
      ],
      allow_other: true,
      other_placeholder: 'Describe the event type',
    }
  }

  if (field === 'operation_scope') {
    return {
      field,
      label: 'Scope',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Scope as small event',
          value: 'Yes, scope this as a lightweight small event',
          description: 'Keep this inside the current 3rdSpace launch scope',
        },
        {
          label: 'One-day only',
          value: 'Day-only lightweight format',
          description: 'No lodging, complex transport, or multi-day production',
        },
        {
          label: 'Side-event version',
          value: 'Convert this into a side event',
          description: 'Best for Tech Week-style programming and community gatherings',
        },
        {
          label: 'Not a fit',
          value: 'This is not a lightweight event',
          description: 'Stop before venue/vendor recommendations',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. yes, make it a one-day offsite',
    }
  }

  if (field === 'date') {
    return {
      field,
      label: 'Date window',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Next two weeks',
          value: 'next two weeks',
          description: 'Prioritize venues and vendors that can confirm quickly',
        },
        {
          label: 'Next month',
          value: 'next month',
          description: 'More supply options, still a near-term planning window',
        },
        {
          label: 'Weekend window',
          value: 'next weekend',
          description: 'Best when guest availability matters more than exact date',
        },
        {
          label: 'This weekend',
          value: 'this weekend',
          description: 'Use the nearest upcoming Saturday/Sunday window',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. Apr 18, late June, first weekend of August',
    }
  }

  if (field === 'time_preference') {
    const isDinnerTimeQuestion = isDinnerLike(context.event_type)

    return {
      field,
      label: 'Time preference',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: isDinnerTimeQuestion
        ? [
            {
              label: 'Weekday evening',
              value: 'weekday evening',
              description: 'Best for private dinners after work, usually 6-10 PM',
            },
            {
              label: 'Weekend evening',
              value: 'weekend evening',
              description: 'Best for hosted dinners, supper clubs, and longer meals',
            },
            {
              label: 'Weekend night',
              value: 'weekend night',
              description: 'Best when dinner may extend into drinks or late-night programming',
            },
          ]
        : [
            {
              label: 'Weekday evening',
              value: 'weekday evening',
              description: 'Good for mixers, panels, dinners, and after-work events',
            },
            {
              label: 'Weekend daytime',
              value: 'weekend daytime',
              description: 'Best for day parties, wellness, sports, and family events',
            },
            {
              label: 'Weekend night',
              value: 'weekend night',
              description: 'Best for nightlife, birthday, music, and ticketed events',
            },
            {
              label: 'Flexible',
              value: 'flexible time',
              description: 'Let the agent optimize for venue/vendor availability',
            },
          ],
      allow_other: !isDinnerTimeQuestion,
      other_placeholder: isDinnerTimeQuestion ? 'e.g. Friday 7-10 PM' : 'e.g. Thursday 6-9 PM',
    }
  }

  if (field === 'area') {
    return {
      field,
      label: 'Area',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'San Francisco',
          value: 'San Francisco',
          description: 'Use this if any SF neighborhood works',
        },
        {
          label: 'SoMa / Downtown',
          value: 'SOMA',
          description: 'Central, startup-friendly, venue-dense',
        },
        {
          label: 'Mission / Hayes Valley',
          value: 'Mission',
          description: 'Better for social, creative, and nightlife energy',
        },
        {
          label: 'Oakland / East Bay',
          value: 'Downtown Oakland',
          description: 'Often more flexible on budget and capacity',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. Napa, Berkeley, downtown SF, Peninsula',
    }
  }

  if (field === 'budget') {
    return {
      field,
      label: 'Budget',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: '$500 starter',
          value: 'under $500',
          description: 'Free space, DIY setup, no paid vendor dependency',
        },
        {
          label: '$2k standard',
          value: 'under $2k',
          description: 'Free or low-cost space plus only essential services',
        },
        {
          label: '$8k elevated',
          value: 'around $8k',
          description: 'Paid venue or minimum spend with focused vendor support',
        },
        {
          label: '$15k premium',
          value: 'around $15k',
          description: 'Stronger venue fit, vendors, staffing, and production',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. $300, under $2k, around $10k',
    }
  }

  if (field === 'vendor_needs') {
    return {
      field,
      label: 'Vendor needs',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'No vendors',
          value: 'No vendors needed',
          description: 'You only need the venue or booking path',
        },
        {
          label: 'Food + beverage',
          value: 'Catering / food, bar / beverage',
          description: 'Catering, bar package, mocktails, bartender, or drink service',
        },
        {
          label: 'Music / entertainment',
          value: 'DJ / music',
          description: 'DJ, live music, playlist support, or entertainment',
        },
        {
          label: 'Ops / production',
          value: 'AV / production, security, check-in staff',
          description: 'AV, staffing, check-in, security, or event production',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. photographer, coach, instructor, valet',
    }
  }

  if (field === 'ticketing_model') {
    return {
      field,
      label: 'Ticketing model',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Free RSVP',
          value: 'Free RSVP',
          description: 'Guests RSVP but do not pay to attend',
        },
        {
          label: 'Paid admission',
          value: 'Paid admission',
          description: 'Ticket covers access only. Food or drinks can be separate.',
        },
        {
          label: 'Paid dinner ticket',
          value: 'Paid dinner ticket',
          description: 'Ticket includes the meal or package cost',
        },
        {
          label: 'External platform',
          value: 'External ticketing platform',
          description: 'Use Luma, Posh, Partiful, or Eventbrite as source of truth',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. invite-only, donation-based, sponsor RSVP',
    }
  }

  if (field === 'food_responsibility') {
    return {
      field,
      label: 'Food + beverage',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Guests pay venue',
          value: 'Guests pay venue directly',
          description: 'Ticket covers access only; guests order/pay onsite',
        },
        {
          label: 'Ticket includes food',
          value: 'Ticket includes food',
          description: 'Model food cost inside the ticket or budget',
        },
        {
          label: 'Organizer prepays',
          value: 'Organizer prepays food/beverage',
          description: 'Prix fixe, catering, hosted bar, or guaranteed spend',
        },
        {
          label: 'No food needed',
          value: 'No food/beverage needed',
          description: 'Venue-only or activity-first event',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. sponsor covers food, cash bar, drink tickets',
    }
  }

  if (field === 'amenities') {
    return {
      field,
      label: 'Amenities',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Standard setup',
          value: 'Standard setup is fine',
          description: 'No special venue requirements beyond the booking basics',
        },
        {
          label: 'AV + screens',
          value: 'DJ hookup, TV screens, projector, microphones, sound system',
          description: 'Best for music, panels, watch parties, demos, and presentations',
        },
        {
          label: 'Extra time / storage',
          value: 'extra setup time, storage, green room',
          description: 'Early load-in, vendor storage, prep space, or green room',
        },
        {
          label: 'Activity support',
          value: 'court access, equipment rental, check-in table',
          description: 'Courts, gear, check-in table, participant flow, or activity setup',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. tennis courts, parking, kitchen, wifi',
    }
  }

  if (field === 'venue_terms') {
    return {
      field,
      label: 'Venue terms',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Free space',
          value: 'Free space',
          description: 'Prioritize no-rental-fee or partner spaces',
        },
        {
          label: 'Minimum spend',
          value: 'Minimum spend',
          description: 'Venue earns from food/drinks instead of room rental',
        },
        {
          label: 'Flat rental',
          value: 'Flat rental',
          description: 'Clear rental fee, no upside share',
        },
        {
          label: 'Deposit hold',
          value: 'Deposit / refundable hold',
          description: 'Use a refundable deposit or short soft hold',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. flexible, per-head kickback, sponsor-covered',
    }
  }

  if (field === 'revenue_share') {
    return {
      field,
      label: 'Revenue model',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Simple rental',
          value: 'No revenue share',
          description: 'Flat rental or minimum spend. Easiest to explain and book.',
        },
        {
          label: 'Bar share',
          value: 'Bar revenue share',
          description: 'Useful when the venue makes money from drinks',
        },
        {
          label: 'Ticket share',
          value: 'Ticket revenue share',
          description: 'Useful for paid events where venue upside can reduce deposit',
        },
        {
          label: 'Per-head',
          value: 'Per-head kickback',
          description: 'Useful for bars or venues paid by confirmed attendee volume',
        },
        {
          label: 'Recommend model',
          value: 'Recommend best model',
          description: 'Let the agent compare flat rental, per-head, and revenue share',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. per-head kickback after 100 attendees',
    }
  }

  if (field === 'action_permission') {
    return {
      field,
      label: 'Agent action',
      prompt: questionPrompt,
      instruction: 'Select one answer',
      options: [
        {
          label: 'Show options only',
          value: 'Show options only',
          description: 'No venue/vendor outreach yet',
        },
        {
          label: 'Send brief',
          value: 'Send brief after approval',
          description: 'Create an approval card before sending the brief',
        },
        {
          label: 'Request holds',
          value: 'Request soft holds after approval',
          description: 'Ask matched venues for temporary availability holds',
        },
        {
          label: 'Concierge review',
          value: 'Concierge review first',
          description: 'Human review before any venue or vendor sees it',
        },
      ],
      allow_other: true,
      other_placeholder: 'e.g. contact only claimed venues',
    }
  }

  return {
    field,
    label: 'Must-haves',
    prompt: questionPrompt,
    instruction: 'Select one answer',
    options: [
      {
        label: 'Venue essentials',
        value: 'AV/projector, sound system, flexible layout',
        description: 'Good when the place has to support programming or talks',
      },
      {
        label: 'Food + drink',
        value: 'catering, bar package, dietary options',
        description: 'Prioritize vendors and venues with built-in service',
      },
      {
        label: 'Atmosphere',
        value: 'rooftop, outdoor space, intimate vibe',
        description: 'Prioritize feel, photos, and guest experience',
      },
      {
        label: 'Operations',
        value: 'parking, security, check-in, accessibility',
        description: 'Prioritize logistics and low day-of risk',
      },
    ],
    allow_other: true,
    other_placeholder: 'e.g. tennis courts, mocktails, DJ, photographer',
  }
}

function buildConfirmationItems(context: MockIntakeContext) {
  const items = [
    { label: 'Event type', value: context.event_type_detected ? context.event_type : 'Need event type', confirmed: context.event_type_detected },
    { label: 'Operating window', value: context.operation_window.label, confirmed: true },
    { label: 'Guest count', value: context.guest_count ? `${context.guest_count} people` : 'Need headcount', confirmed: Boolean(context.guest_count) },
    { label: 'Date', value: context.date ?? 'Need date', confirmed: Boolean(context.date) },
    { label: 'Area', value: context.area ?? 'Need area', confirmed: Boolean(context.area) },
    { label: 'Budget', value: context.budget_cents ? formatCents(context.budget_cents) : 'Need budget', confirmed: Boolean(context.budget_cents) },
    { label: 'Ticketing model', value: context.ticketing_model ?? 'Need ticketing model', confirmed: Boolean(context.ticketing_model) },
    { label: 'Food + beverage', value: context.food_responsibility ?? 'Need food model', confirmed: Boolean(context.food_responsibility) },
    { label: 'Vendors', value: context.vendor_needs ?? 'Need vendor needs', confirmed: Boolean(context.vendor_needs) },
    { label: 'Amenities', value: context.amenities ?? 'Need amenities', confirmed: Boolean(context.amenities) },
    { label: 'Venue terms', value: context.venue_terms ?? 'Need venue terms', confirmed: Boolean(context.venue_terms) },
    { label: 'Revenue model', value: context.revenue_share ?? 'Need revenue model', confirmed: Boolean(context.revenue_share) },
    { label: 'Agent action', value: context.action_permission ?? 'Need action permission', confirmed: Boolean(context.action_permission) },
    { label: 'Duration', value: context.duration ?? 'Not specified', confirmed: Boolean(context.duration) },
    {
      label: 'Requirements',
      value: context.must_haves.length > 0 ? context.must_haves.join(', ') : context.amenities ?? 'None specified',
      confirmed: Boolean(context.must_haves.length > 0 || context.amenities),
    },
  ]

  if (context.date_flexibility === 'flexible') {
    items.splice(3, 0, {
      label: 'Time preference',
      value: context.time_preference ?? 'Need day/time preference',
      confirmed: Boolean(context.time_preference),
    })
  }

  return items
}

function buildTailoredRecommendations(context: MockIntakeContext) {
  const area = context.area && AREA_OPTIONS.includes(context.area) ? context.area : context.area ?? 'SOMA'
  const guestCount = context.guest_count ?? 80
  const budget = context.budget_cents ?? 1000000
  const fit = getVenueFit(context.event_type)
  const baseCapacity = Math.max(guestCount + 25, 75)
  const requirementSummary = formatRequirementSummary(context)
  const vendorSummary = context.vendor_needs && context.vendor_needs !== 'No vendors needed'
    ? context.vendor_needs
    : null
  const termsTag = getRevenueModelTag(context.revenue_share)
  const venueTermsTag = getVenueTermsTag(context.venue_terms)
  const foodTag = getFoodResponsibilityTag(context.food_responsibility)
  const commercialModelOptions = getCommercialModelOptions(context)
  const commercialModelMetadata = commercialModelOptions.length > 0
    ? {
        commercial_model_options: commercialModelOptions,
        recommended_commercial_model: getCommercialModelRecommendation(context),
      }
    : {}
  const avoidPaidVendors = shouldAvoidPaidVendors(context)
  const venuePrice = (ratio: number) => getVenuePriceForCommercialModel(context, budget, ratio)

  if (budget <= 50_000) {
    return [
      {
        name: getCommercialVenueName(area, 'public-space route', context),
        type: 'Venue',
        fit: 'Free-space fit',
        capacity: baseCapacity,
        price_cents: 0,
        action: 'Request hold',
        hold_duration_hours: 0,
        tags: ['Free space', 'Permit check', 'DIY setup', termsTag, foodTag],
        note: `Best for a ${formatCents(budget)} cap: use a free public or partner space and keep logistics lightweight.`,
        ...commercialModelMetadata,
      },
      {
        name: getCommercialVenueName(area, 'community partner room', context),
        type: 'Venue',
        fit: 'Free or donated room',
        capacity: Math.max(baseCapacity, guestCount),
        price_cents: 0,
        action: 'Request hold',
        hold_duration_hours: 12,
        tags: ['Free/low-cost', 'Capacity check', 'Basic amenities', venueTermsTag],
        note: `Prioritizes fit for ${guestCount} guests and ${requirementSummary} without creating a rental cost.`,
        ...commercialModelMetadata,
      },
      {
        name: vendorSummary && !avoidPaidVendors ? `${vendorSummary} quote check` : 'DIY operations checklist',
        type: 'Vendor',
        fit: vendorSummary && !avoidPaidVendors ? 'Lowest-cost service fit' : 'No paid vendor dependency',
        capacity: guestCount,
        price_cents: 0,
        action: 'Email vendor',
        package_summary: vendorSummary && !avoidPaidVendors
          ? `Ask one provider if ${vendorSummary.toLowerCase()} can fit under ${formatCents(budget)}`
          : 'No vendor outreach unless you choose to add a paid service',
        tags: vendorSummary && !avoidPaidVendors ? ['Quote only', 'Budget cap', 'Concierge fallback'] : ['DIY', 'No vendors', 'Free'],
        note: vendorSummary && !avoidPaidVendors
          ? 'The agent should only collect options that stay inside the stated cap.'
          : buildNoVendorNote(context),
      },
    ]
  }

  if (budget <= 200_000) {
    return [
      {
        name: getCommercialVenueName(area, 'community venue', context),
        type: 'Venue',
        fit: 'Under-$2k fit',
        capacity: baseCapacity,
        price_cents: Math.min(125_000, venuePrice(0.55)),
        action: 'Request hold',
        hold_duration_hours: 24,
        tags: ['Low-cost', 'Simple terms', termsTag, venueTermsTag],
        note: `Keeps the space spend below the standard tier while matching ${requirementSummary}.`,
        ...commercialModelMetadata,
      },
      {
        name: getCommercialVenueName(area, 'cafe or bar minimum-spend option', context),
        type: 'Venue',
        fit: 'No-rental-fee path',
        capacity: Math.max(baseCapacity, guestCount + 15),
        price_cents: 0,
        action: 'Request hold',
        hold_duration_hours: 24,
        tags: ['No room fee', 'Minimum spend', 'Fast confirmation', foodTag],
        note: 'Best when the organizer wants a real venue feel without a large upfront rental or prepaid food liability.',
        ...commercialModelMetadata,
      },
      {
        name: vendorSummary && !avoidPaidVendors ? `Essential ${vendorSummary} bundle` : 'Lean staffing fallback',
        type: 'Vendor',
        fit: vendorSummary && !avoidPaidVendors ? 'Essential service fit' : 'Optional service fit',
        capacity: guestCount,
        price_cents: vendorSummary && !avoidPaidVendors ? Math.min(50_000, Math.round(budget * 0.22)) : 0,
        action: 'Email vendor',
        package_summary: vendorSummary && !avoidPaidVendors
          ? `${vendorSummary} scoped to the standard tier`
          : 'No paid vendor needed unless the venue requires staffing',
        tags: vendorSummary && !avoidPaidVendors ? ['Essentials only', 'Quote required', 'Budget-aware'] : ['Optional', 'Venue-dependent', 'No vendor dependency'],
        note: 'Keeps services intentionally narrow so the event remains viable.',
      },
    ]
  }

  if (budget <= 800_000) {
    return [
      {
        name: getCommercialVenueName(area, fit.primaryName, context),
        type: 'Venue',
        fit: fit.primaryFit,
        capacity: baseCapacity,
        price_cents: venuePrice(0.5),
        action: 'Request hold',
        hold_duration_hours: 24,
        tags: [...fit.primaryTags, termsTag, venueTermsTag, foodTag],
        note: buildCommercialVenueNote(context),
        ...commercialModelMetadata,
      },
      {
        name: getCommercialVenueName(area, fit.secondaryName, context),
        type: 'Venue',
        fit: fit.secondaryFit,
        capacity: Math.max(baseCapacity + 40, guestCount),
        price_cents: venuePrice(0.38),
        action: 'Request hold',
        hold_duration_hours: 24,
        tags: fit.secondaryTags,
        note: 'Lower-risk option with simpler logistics and more budget left for vendors.',
        ...commercialModelMetadata,
      },
      {
        name: vendorSummary && !avoidPaidVendors ? `${vendorSummary} support package` : `${context.event_type} service reserve`,
        type: 'Vendor',
        fit: vendorSummary && !avoidPaidVendors ? 'Service fit' : 'Optional service reserve',
        capacity: guestCount,
        price_cents: vendorSummary && !avoidPaidVendors ? Math.round(budget * 0.18) : 0,
        action: 'Email vendor',
        package_summary: vendorSummary && !avoidPaidVendors
          ? `${vendorSummary} support for ${guestCount} guests`
          : `Optional services only if the selected venue needs them`,
        tags: vendorSummary && !avoidPaidVendors ? ['Service match', 'Setup support', 'Quote required'] : ['Optional', 'Keep budget flexible', 'No vendor dependency'],
        note: 'Agent can email vendors and collect terms after approval.',
      },
    ]
  }

  return [
    {
      name: getCommercialVenueName(area, fit.primaryName, context),
      type: 'Venue',
      fit: fit.primaryFit,
      capacity: baseCapacity,
      price_cents: venuePrice(0.52),
      action: 'Request hold',
      hold_duration_hours: 24,
      tags: [...fit.primaryTags, termsTag, venueTermsTag, foodTag],
      note: buildCommercialVenueNote(context),
      ...commercialModelMetadata,
    },
    {
      name: getCommercialVenueName(area, fit.secondaryName, context),
      type: 'Venue',
      fit: fit.secondaryFit,
      capacity: Math.max(baseCapacity + 50, guestCount),
      price_cents: venuePrice(0.42),
      action: 'Request hold',
      hold_duration_hours: 24,
      tags: fit.secondaryTags,
      note: 'Lower-risk option with simpler logistics and flexible layout.',
      ...commercialModelMetadata,
    },
    {
      name: vendorSummary && !avoidPaidVendors ? `${vendorSummary} premium support` : `${context.event_type} vendor reserve`,
      type: 'Vendor',
      fit: vendorSummary && !avoidPaidVendors ? 'Premium service fit' : 'Optional service reserve',
      capacity: guestCount,
      price_cents: vendorSummary && !avoidPaidVendors ? Math.round(budget * 0.18) : 0,
      action: 'Email vendor',
      package_summary: vendorSummary && !avoidPaidVendors
        ? `${vendorSummary} support for ${guestCount} guests`
        : `Reserve for services only if the final venue requires them`,
      tags: vendorSummary && !avoidPaidVendors
        ? ['Staffing', 'Setup support', 'Quote required']
        : ['Optional', 'Quote only if needed', 'No vendor dependency'],
      note: vendorSummary && !avoidPaidVendors
        ? 'Agent can email vendors and collect terms after approval.'
        : 'No paid vendor should be proposed unless it improves fit or removes risk.',
    },
  ]
}

function getRevenueModelTag(revenueShare: string | null) {
  if (!revenueShare) return 'Terms TBD'
  if (revenueShare === 'No revenue share') return 'Flat/simple terms'
  if (isRecommendBestModel(revenueShare)) return 'Compare commercial models'
  return revenueShare
}

function isRecommendBestModel(revenueShare: string | null | undefined) {
  return /\brecommend best model|recommend model|compare\b/i.test(revenueShare ?? '')
}

function getCommercialModelOptions(context: MockIntakeContext) {
  if (!isRecommendBestModel(context.revenue_share)) return []

  const options = ['Flat rental', 'Minimum spend', 'Per-head kickback']
  if (/\b(ticket|paid|door|vip|ga|early bird)\b/i.test(context.ticketing_model ?? context.conversation_text)) {
    options.push('Ticket revenue share')
  }
  if (/\b(bar|drink|cocktail|beer|wine|alcohol|cash bar|open bar)\b/i.test(context.food_responsibility ?? context.conversation_text)) {
    options.push('Bar revenue share')
  }

  return mergeUnique(options)
}

function getCommercialModelRecommendation(context: MockIntakeContext) {
  if (!isRecommendBestModel(context.revenue_share)) return context.revenue_share

  if (/\bguests pay|cash bar\b/i.test(context.food_responsibility ?? context.conversation_text)) {
    return 'Bar revenue share or per-head kickback'
  }
  if (/\b(ticket|paid|door|vip|ga|early bird)\b/i.test(context.ticketing_model ?? context.conversation_text)) {
    return 'Ticket revenue share or per-head kickback'
  }
  if ((context.guest_count ?? 0) > 100) return 'Per-head kickback'
  return 'Flat rental or minimum spend'
}

function getVenueTermsTag(venueTerms: string | null) {
  return venueTerms ?? 'Venue terms TBD'
}

function getFoodResponsibilityTag(foodResponsibility: string | null) {
  if (!foodResponsibility) return 'Food model TBD'
  if (/guests pay/i.test(foodResponsibility)) return 'Guest-pay F&B'
  if (/ticket includes/i.test(foodResponsibility)) return 'Food in ticket'
  return foodResponsibility
}

function shouldAvoidPaidVendors(context: MockIntakeContext) {
  return context.vendor_needs === 'No vendors needed'
    || /\b(guests pay|no food|sponsor covers)\b/i.test(context.food_responsibility ?? '')
}

function getVenuePriceForCommercialModel(context: MockIntakeContext, budget: number, ratio: number) {
  if (/\b(free space|minimum spend)\b/i.test(context.venue_terms ?? '')) return 0
  if (/\bguests pay\b/i.test(context.food_responsibility ?? '') && isDinnerLike(context.event_type)) {
    return Math.round(budget * Math.min(ratio, 0.25))
  }
  return Math.round(budget * ratio)
}

function getPrimaryVenueEstimateCents(context: MockIntakeContext, budget: number) {
  if (budget <= 50_000) return 0
  if (budget <= 200_000) return Math.min(125_000, getVenuePriceForCommercialModel(context, budget, 0.55))
  if (budget <= 800_000) return getVenuePriceForCommercialModel(context, budget, 0.5)
  return getVenuePriceForCommercialModel(context, budget, 0.52)
}

function getCommercialVenueName(area: string, baseName: string, context: MockIntakeContext) {
  if (isDinnerLike(context.event_type)) {
    const text = context.conversation_text
    if (/\bguests pay|a la carte|cash bar\b/i.test(context.food_responsibility ?? text)) {
      return `${area} guest-pay private dining room`
    }
    if (/\bfull buyout|buyout\b/i.test(text)) return `${area} restaurant buyout`
    if (/\bprivate room|private dining|chef'?s table\b/i.test(text)) return `${area} private dining room`
    if (/\btasting menu|prix fixe\b/i.test(text)) return `${area} prix fixe dining room`
    return `${area} restaurant dinner fit`
  }
  if (/\bminimum spend\b/i.test(context.venue_terms ?? '')) return `${area} minimum-spend ${baseName}`
  if (/\bfree space\b/i.test(context.venue_terms ?? '')) return `${area} free-space ${baseName}`
  return `${area} ${baseName}`
}

function buildCommercialVenueNote(context: MockIntakeContext) {
  const area = context.area ?? 'the Bay Area'
  const guestLabel = context.guest_count ? `${context.guest_count} guests` : 'your target headcount'
  const terms = (isRecommendBestModel(context.revenue_share)
    ? getCommercialModelRecommendation(context)
    : context.venue_terms ?? context.revenue_share) ?? 'terms still to confirm'
  const requirements = formatRequirementSummary(context)

  if (isDinnerLike(context.event_type) && /\bguests pay\b/i.test(context.food_responsibility ?? '')) {
    const comparison = isRecommendBestModel(context.revenue_share)
      ? ` Agent should compare ${getCommercialModelOptions(context).join(', ').toLowerCase()} before outreach.`
      : ''
    return `Guest-pay dining fit in ${area} for ${guestLabel}. Prioritizes venues where guests can order directly so ticket revenue is not consumed by per-person food liability.${comparison}`
  }
  if (isDinnerLike(context.event_type)) {
    return buildDinnerVenueNote(context, area, guestLabel, requirements, terms)
  }
  if (isRecommendBestModel(context.revenue_share)) {
    return `${formatEventTypeForSentence(context.event_type)} venue in ${area} for ${guestLabel}. Agent should compare ${getCommercialModelOptions(context).join(', ').toLowerCase()} and pick the structure that protects organizer profit while giving the venue enough upside.`
  }
  if (/\bticket includes food\b/i.test(context.food_responsibility ?? '')) {
    return `Package-friendly venue in ${area} for ${guestLabel}. Best fit when food and beverage pricing can be quoted clearly inside the ticket economics.`
  }
  return `${formatEventTypeForSentence(context.event_type)} venue in ${area} with capacity for ${guestLabel} and ${terms.toLowerCase()} terms. Fits ${requirements}.`
}

function buildDinnerVenueNote(
  context: MockIntakeContext,
  area: string,
  guestLabel: string,
  requirements: string,
  terms: string
) {
  const text = context.conversation_text
  const room = /\bfull buyout|buyout\b/i.test(text)
    ? 'full-buyout restaurant'
    : /\bsemi-private\b/i.test(text)
      ? 'semi-private dining'
      : /\bprivate room|private dining|chef'?s table\b/i.test(text)
        ? 'private dining room'
        : 'restaurant/private dining'
  const foodModel = context.food_responsibility ?? 'food model still to confirm'

  return `Dinner fit in ${area} for ${guestLabel}. Prioritizes ${room}, ${foodModel.toLowerCase()}, and ${terms.toLowerCase()} terms while matching ${requirements}.`
}

function formatRequirementSummary(context: MockIntakeContext) {
  const source = context.must_haves.length > 0
    ? context.must_haves
    : context.amenities
      ? context.amenities.split(/\s*,\s*/)
      : []
  const cleaned = mergeUnique(source.map(cleanRequirementItem)).slice(0, 3)

  if (cleaned.length === 0) return 'your stated event requirements'
  if (cleaned.length === 1) return cleaned[0]
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`
}

function formatEventTypeForSentence(eventType: string) {
  return eventType.charAt(0).toUpperCase() + eventType.slice(1).toLowerCase()
}

function isDinnerLike(eventType: string | null | undefined) {
  return Boolean(eventType && /\b(dinner|supper|tasting|private dining|founder dinner)\b/i.test(eventType))
}

function buildNoVendorNote(context: MockIntakeContext) {
  if (/\bguests pay\b/i.test(context.food_responsibility ?? '')) {
    return 'The agent will avoid paid vendors and prioritize venues with onsite guest-pay ordering.'
  }
  return 'The agent will recommend free setup paths and avoid paid vendors.'
}

function buildMockOpportunityApprovalMetadata(context: MockIntakeContext) {
  const budget = context.budget_cents ?? 1_000_000
  const venueEstimate = getPrimaryVenueEstimateCents(context, budget)
  const venueDeposit = venueEstimate > 0 ? venueEstimate : 0
  const vendorDeposit = shouldAvoidPaidVendors(context) ? 0 : Math.max(10_000, Math.round(budget * 0.06))
  const approvalAmount = venueDeposit
  const opportunityId = `mock-opportunity-${Date.now()}`
  const invites = [
    {
      id: `${opportunityId}-venue-1`,
      opportunity_id: opportunityId,
      target_type: 'venue',
      name: `${context.area ?? 'Bay Area'} top venue fit`,
      status: 'pending_organizer_approval',
      is_claimed: true,
      route_to_concierge: false,
      match_score: 88,
      capacity_fit: true,
      budget_fit: true,
      proposed_deposit_cents: venueDeposit,
      venue_response_json: { status: 'pending' },
    },
    {
      id: `${opportunityId}-venue-2`,
      opportunity_id: opportunityId,
      target_type: 'venue',
      name: `${context.area ?? 'Bay Area'} unclaimed catalog option`,
      status: 'pending_organizer_approval',
      is_claimed: false,
      route_to_concierge: true,
      match_score: 79,
      capacity_fit: true,
      budget_fit: true,
      proposed_deposit_cents: venueDeposit,
      venue_response_json: { status: 'pending' },
    },
    {
      id: `${opportunityId}-vendor-1`,
      opportunity_id: opportunityId,
      target_type: 'vendor',
      name: `${context.event_type} support vendor`,
      status: 'pending_organizer_approval',
      is_claimed: false,
      route_to_concierge: true,
      match_score: 74,
      capacity_fit: true,
      budget_fit: true,
      proposed_deposit_cents: vendorDeposit,
      venue_response_json: { status: 'pending' },
    },
  ]

  return {
    state: 'opportunity_approval_requested',
    status: 'pending',
    opportunity: {
      id: opportunityId,
      title: `${context.event_type} opportunity`,
      event_type: context.event_type,
      operation_window: context.operation_window,
      guest_count: context.guest_count,
      neighborhood: context.area,
      budget_cents: context.budget_cents,
      ticketing_model: context.ticketing_model,
      food_responsibility: context.food_responsibility,
      vendor_needs: context.vendor_needs,
      amenities: context.amenities,
      venue_terms: context.venue_terms,
      revenue_share: context.revenue_share,
      action_permission: context.action_permission,
      must_haves: context.must_haves,
      deposit_target_cents: approvalAmount,
      status: 'approval_requested',
    },
    invites,
    deposit_proposals: invites.map((invite) => ({
      target_type: invite.target_type,
      name: invite.name,
      proposed_deposit_cents: invite.proposed_deposit_cents,
      match_score: invite.match_score,
      route_to_concierge: invite.route_to_concierge,
    })),
    approval: {
      id: `mock-approval-${opportunityId}`,
      action_label: 'Send to venues',
      label: context.operation_window.posture === 'constrained' ? 'Send lightweight event brief' : 'Send to venues',
      provider: '3rdSpace venue + vendor network',
      requested_amount_cents: approvalAmount,
      amount_cents: approvalAmount,
      price_cents: approvalAmount,
      vendor_reserve_cents: vendorDeposit,
      fees_cents: 0,
      event_date: context.date_window_start ?? '',
      delivery_email: 'No payment now',
      refund_terms: 'No payment is collected by sending the brief.',
      cancellation_terms: 'You can cancel before a venue or vendor accepts terms.',
      terms: 'Authorize outreach only. Deposits are proposed and need approval before booking.',
      package_details:
        `Send ${context.operation_window.label.toLowerCase()} brief to matched venues and vendors. Commercial model: ${[
          context.ticketing_model,
          context.food_responsibility,
          context.venue_terms,
          context.revenue_share,
          context.action_permission,
        ].filter(Boolean).join(' · ') || 'TBD'}. Unclaimed listings route to concierge fallback.`,
      status: 'pending',
    },
  }
}

function getVenueFit(eventType: string) {
  const lower = eventType.toLowerCase()
  if (lower.includes('hackathon')) {
    return {
      primaryName: 'Builder Loft',
      primaryFit: 'Open floor plan',
      primaryTags: ['Open floor plan', 'High-speed wifi', 'Power access'],
      secondaryName: 'Campus Hall',
      secondaryFit: 'Overnight-capable',
      secondaryTags: ['Breakout rooms', 'AV/projector', 'Security ready'],
    }
  }
  if (lower.includes('wedding')) {
    return {
      primaryName: 'Garden House',
      primaryFit: 'Garden / historic',
      primaryTags: ['Garden', 'Historic', 'Catering friendly'],
      secondaryName: 'Reception Hall',
      secondaryFit: 'Classic reception',
      secondaryTags: ['Dance floor', 'Private bar', 'Photo moments'],
    }
  }
  if (isDinnerLike(eventType)) {
    return {
      primaryName: 'Private Dining Room',
      primaryFit: 'Restaurant/private dining',
      primaryTags: ['Private room', 'Menu fit', 'Service included'],
      secondaryName: 'Minimum-Spend Restaurant',
      secondaryFit: 'Lower deposit path',
      secondaryTags: ['Minimum spend', 'Guest-pay option', 'Bar package'],
    }
  }
  if (lower.includes('music') || lower.includes('performance') || lower.includes('film')) {
    return {
      primaryName: 'Performance Room',
      primaryFit: 'Production ready',
      primaryTags: ['Stage', 'Sound', 'Lighting'],
      secondaryName: 'Screening Lounge',
      secondaryFit: 'AV-first',
      secondaryTags: ['Projector', 'Seated layout', 'Green room'],
    }
  }
  if (lower.includes('kids')) {
    return {
      primaryName: 'Family Studio',
      primaryFit: 'Kid-friendly',
      primaryTags: ['Kid-friendly', 'Outdoor space', 'Easy parking'],
      secondaryName: 'Play Hall',
      secondaryFit: 'Low-friction setup',
      secondaryTags: ['Open layout', 'Restrooms nearby', 'Catering allowed'],
    }
  }
  if (lower.includes('gallery') || lower.includes('art')) {
    return {
      primaryName: 'Gallery Space',
      primaryFit: 'White-wall gallery',
      primaryTags: ['Gallery lighting', 'Flexible walls', 'Reception layout'],
      secondaryName: 'Creative Studio',
      secondaryFit: 'Industrial creative',
      secondaryTags: ['Industrial', 'AV/projector', 'Street-level access'],
    }
  }
  if (lower.includes('tennis')) {
    return {
      primaryName: 'Court Club',
      primaryFit: 'Court-ready',
      primaryTags: ['Tennis courts', 'Equipment access', 'Outdoor option'],
      secondaryName: 'Athletic Terrace',
      secondaryFit: 'Social sports fit',
      secondaryTags: ['Court rental', 'Coach optional', 'Post-play lounge'],
    }
  }
  if (/\b(chess|trivia|poker|gaming|tournament|competition)\b/i.test(lower)) {
    return {
      primaryName: 'Competition Lounge',
      primaryFit: 'Competitive social',
      primaryTags: ['Flexible seating', 'Check-in table', 'Low-noise room'],
      secondaryName: 'Club Room',
      secondaryFit: 'Simple tournament setup',
      secondaryTags: ['Tables included', 'Food allowed', 'Prize table ready'],
    }
  }
  if (/\b(pickleball|basketball|soccer|volleyball|golf|sports?)\b/i.test(lower)) {
    return {
      primaryName: 'Athletic Club',
      primaryFit: 'Sports social',
      primaryTags: ['Reserved play area', 'Post-play lounge', 'Equipment optional'],
      secondaryName: 'Rec Center',
      secondaryFit: 'Budget sports fit',
      secondaryTags: ['Flexible schedule', 'Food allowed', 'Group check-in'],
    }
  }

  return {
    primaryName: 'Social Hall',
    primaryFit: 'Best fit',
    primaryTags: ['AV/projector', 'Flexible layout', 'Bar package'],
    secondaryName: 'Event Loft',
    secondaryFit: 'Budget fit',
    secondaryTags: ['Industrial', 'Catering allowed', 'Private entrance'],
  }
}

function buildOpenQaResponse(context: MockIntakeContext, userInput: string) {
  return `Noted. I will keep the ${context.event_type.toLowerCase()} plan centered on ${context.guest_count ?? 'the target'} guests, ${context.area ?? 'the preferred Bay Area location'}, ${context.date ?? 'the date window'}, a ${context.budget_cents ? formatCents(context.budget_cents) : 'flexible'} budget, ${context.ticketing_model ?? 'ticketing TBD'}, ${context.food_responsibility ?? 'food/beverage responsibility TBD'}, ${context.vendor_needs ?? 'vendor needs TBD'}, ${context.venue_terms ?? 'venue terms TBD'}, and ${context.action_permission ?? 'agent action TBD'}. Latest note: "${userInput}".`
}

function formatDateWindowForSentence(context: MockIntakeContext) {
  if (context.date_window_start && context.date_window_end && context.date_window_start !== context.date_window_end) {
    return `sometime between ${formatIsoDateForDisplay(context.date_window_start)} and ${formatIsoDateForDisplay(context.date_window_end)}`
  }

  return `around ${context.date ?? 'the date window'}`
}

function normalizeDateHint(date: string | null) {
  if (!date) return null
  const monthDay = date.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (!monthDay) return null

  const monthMap: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    sept: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  }
  const month = monthMap[monthDay[1].slice(0, 4).toLowerCase()] ?? monthMap[monthDay[1].slice(0, 3).toLowerCase()]
  return month ? `2026-${month}-${monthDay[2].padStart(2, '0')}` : null
}

function currentPlanningYear() {
  return new Date().getFullYear()
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + days)
  return nextDate
}

function toLocalIsoDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function formatMonthDay(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function formatIsoDateForDisplay(isoDate: string) {
  const [year, month, day] = isoDate.split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return formatMonthDay(new Date(year, month - 1, day))
}

function monthNumber(value: string) {
  const token = value.toLowerCase().replace('.', '')
  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }

  return monthMap[token] ?? 1
}

function monthBandDays(modifier: string, month: number): [number, number] {
  if (modifier.toLowerCase() === 'early') return [1, 10]
  if (modifier.toLowerCase() === 'mid') return [11, 20]
  return [21, new Date(currentPlanningYear(), month, 0).getDate()]
}

function weekendWindowForMonth(ordinal: string, month: number): [string | null, string | null] {
  const weekends: Date[] = []
  const year = currentPlanningYear()
  const daysInTargetMonth = new Date(year, month, 0).getDate()

  for (let day = 1; day <= daysInTargetMonth; day += 1) {
    const date = new Date(year, month - 1, day)
    if (date.getDay() === 6) weekends.push(date)
  }

  const indexMap: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    last: weekends.length - 1,
  }
  const saturday = weekends[indexMap[ordinal.toLowerCase()]]
  if (!saturday) return [null, null]

  return [toLocalIsoDate(saturday), toLocalIsoDate(addDays(saturday, 1))]
}

function relativeNumber(value: string, fallback: number) {
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

function toTitleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function monthDisplayName(value: string) {
  const token = value.toLowerCase().replace('.', '')
  const monthMap: Record<string, string> = {
    jan: 'January',
    january: 'January',
    feb: 'February',
    february: 'February',
    mar: 'March',
    march: 'March',
    apr: 'April',
    april: 'April',
    may: 'May',
    jun: 'June',
    june: 'June',
    jul: 'July',
    july: 'July',
    aug: 'August',
    august: 'August',
    sep: 'September',
    sept: 'September',
    september: 'September',
    oct: 'October',
    october: 'October',
    nov: 'November',
    november: 'November',
    dec: 'December',
    december: 'December',
  }

  return monthMap[token] ?? toTitleCase(value)
}

function formatOrdinal(value: number) {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? 'th'
      : value % 10 === 1
        ? 'st'
        : value % 10 === 2
          ? 'nd'
          : value % 10 === 3
            ? 'rd'
            : 'th'

  return `${value}${suffix}`
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
