import { getArchetypeByKey, resolveArchetypeKey } from '@/lib/planner/archetypes/resolveArchetype'
import { matchingFieldSchema } from '@/lib/planner/archetypes/types'
import type {
  CommercialModel,
  EventArchetypeConfig,
  MatchingField,
  ServiceType,
} from '@/lib/planner/archetypes/types'

export type ArchetypeIntakeQuestionSource =
  | 'matching_field'
  | 'vendor_stack'
  | 'required_amenity'
  | 'commercial_model'
  | 'operational_timing'

export interface ArchetypeIntakeQuestion {
  id: string
  label: string
  prompt: string
  source: ArchetypeIntakeQuestionSource
  required: boolean
  priority: number
  field?: string
  answer_keywords: string[]
}

interface PlanLike {
  event_type?: string | null
  food_responsibility?: string | null
  ticketing_model?: string | null
  venue_terms?: string | null
  agent_action?: string | null
  metadata?: unknown
}

interface ConversationMessageLike {
  role: string
  content: string
  metadata?: unknown
  created_at?: string
}

export const ANSWERED_ARCHETYPE_QUESTIONS_METADATA_KEY = 'answered_archetype_questions'
export const PENDING_ARCHETYPE_QUESTION_METADATA_KEY = 'pending_archetype_question'

interface NextQuestionInput {
  archetype?: EventArchetypeConfig | null
  eventType?: string | null
  plan?: PlanLike | null
  conversationText: string
  includeRecommended?: boolean
}

const SERVICE_QUESTION_COPY: Record<ServiceType, Omit<ArchetypeIntakeQuestion, 'source' | 'required' | 'priority'>> = {
  photographer: {
    id: 'photo_capture',
    label: 'Photo capture',
    prompt: 'Do you need a photographer for recap, sponsor, press, or guest photos?',
    answer_keywords: ['photographer', 'photo', 'photos', 'recap', 'press photos', 'sponsor photos'],
  },
  videographer: {
    id: 'video_recording',
    label: 'Video',
    prompt: 'Do you need video, livestream, recap clips, or full recording?',
    answer_keywords: ['video', 'videographer', 'livestream', 'recording', 'recap clips', 'film'],
  },
  dj: {
    id: 'music_dj',
    label: 'Music',
    prompt: 'Do you need a DJ or music operator, or are you bringing your own playback?',
    answer_keywords: ['dj', 'music', 'playlist', 'playback', 'audio host', 'artist', 'lineup'],
  },
  music_coordinator: {
    id: 'music_dj',
    label: 'Music',
    prompt: 'Do you need live music coordination, a DJ, or curated playback?',
    answer_keywords: ['live music', 'music coordinator', 'dj', 'playlist', 'playback', 'audio host', 'artist', 'lineup'],
  },
  catering: {
    id: 'food_plan',
    label: 'Food',
    prompt: 'What food plan should I match: venue-provided, outside catering, light bites, full meal, or none?',
    field: 'food_responsibility',
    answer_keywords: ['food', 'catering', 'meal', 'light bites', 'snacks', 'dinner', 'lunch', 'brunch', 'none'],
  },
  bartending: {
    id: 'bar_plan',
    label: 'Bar',
    prompt: 'What bar setup do you want: hosted bar, cash bar, minimum spend, or revenue share?',
    field: 'food_responsibility',
    answer_keywords: ['bar', 'bartender', 'hosted bar', 'cash bar', 'minimum spend', 'revenue share', 'drinks'],
  },
  av_production: {
    id: 'av_production',
    label: 'AV',
    prompt: 'What AV or production setup do you need: sound, mics, stage, lighting, screen, recording, or livestream?',
    answer_keywords: ['av', 'sound', 'mics', 'microphone', 'microphones', 'stage', 'lighting', 'screen', 'projector', 'recording', 'livestream', 'live stream'],
  },
  check_in: {
    id: 'check_in',
    label: 'Check-in',
    prompt: 'What check-in flow do you need: RSVP list, ticket scan, badges, waivers, or guest-list control?',
    answer_keywords: ['check-in', 'check in', 'ticket scan', 'badges', 'waivers', 'guest list', 'guest-list', 'registration'],
  },
  security: {
    id: 'security',
    label: 'Security',
    prompt: 'Do you need security, door staff, crowd control, or guest-list enforcement?',
    answer_keywords: ['security', 'door staff', 'crowd control', 'guest list', 'guest-list', 'bouncer'],
  },
  decor: {
    id: 'decor_branding',
    label: 'Decor',
    prompt: 'What decor, branding, staging, or setup needs should the venue support?',
    answer_keywords: ['decor', 'branding', 'staging', 'signage', 'step and repeat', 'flowers', 'floral'],
  },
  staffing: {
    id: 'onsite_staffing',
    label: 'Staffing',
    prompt: 'What staff or onsite producer support do you need for setup, guest flow, and breakdown?',
    answer_keywords: ['staff', 'staffing', 'producer', 'volunteer', 'setup crew', 'guest flow', 'breakdown'],
  },
  instructor: {
    id: 'instructor',
    label: 'Instructor',
    prompt: 'Do you already have an instructor, coach, facilitator, or should I source one?',
    answer_keywords: ['instructor', 'coach', 'facilitator', 'teacher', 'trainer', 'source one'],
  },
  transport: {
    id: 'transport',
    label: 'Transport',
    prompt: 'Do you need transportation, shuttle, parking, or arrival support?',
    answer_keywords: ['transport', 'transportation', 'shuttle', 'parking', 'arrival support', 'rideshare'],
  },
  cake_pastry: {
    id: 'cake_pastry',
    label: 'Cake',
    prompt: 'Do you need cake, dessert, pastry service, or a dedicated cake table?',
    answer_keywords: ['cake', 'dessert', 'pastry', 'cake table'],
  },
  photo_booth: {
    id: 'photo_booth',
    label: 'Photo booth',
    prompt: 'Do you want a photo booth or guest photo moment?',
    answer_keywords: ['photo booth', 'guest photo', 'photo moment'],
  },
  florist: {
    id: 'florals',
    label: 'Florals',
    prompt: 'Do you need florals or decorative arrangements?',
    answer_keywords: ['floral', 'florals', 'flowers', 'arrangements'],
  },
  lighting: {
    id: 'lighting',
    label: 'Lighting',
    prompt: 'What lighting setup do you need for the room, stage, or dance floor?',
    answer_keywords: ['lighting', 'lights', 'uplighting', 'stage lights', 'dance floor'],
  },
  permits: {
    id: 'permits',
    label: 'Permits',
    prompt: 'Do you need permits, sidewalk use, park permission, sampling approval, or vending clearance?',
    answer_keywords: ['permit', 'permits', 'sidewalk', 'park permission', 'sampling', 'vending clearance'],
  },
  pos_systems: {
    id: 'pos_data',
    label: 'POS',
    prompt: 'Do you need POS, lead capture, ticket scan, or sales reporting for this event?',
    answer_keywords: ['pos', 'lead capture', 'sales reporting', 'ticket scan', 'checkout'],
  },
}

const MATCHING_FIELD_QUESTION_COPY: Record<MatchingField, Omit<ArchetypeIntakeQuestion, 'source' | 'required' | 'priority'>> = {
  event_type: {
    id: 'event_type',
    label: 'Event type',
    prompt: 'What kind of event is this closest to: mixer, dinner, workshop, party, or something else?',
    field: 'event_type',
    answer_keywords: ['mixer', 'dinner', 'workshop', 'party', 'panel', 'launch', 'hackathon', 'showcase'],
  },
  neighborhood: {
    id: 'neighborhood',
    label: 'Area',
    prompt: 'What neighborhood or city should I search in?',
    field: 'neighborhood',
    answer_keywords: ['sf', 'san francisco', 'soma', 'mission', 'hayes valley', 'oakland', 'berkeley', 'napa'],
  },
  guest_count: {
    id: 'guest_count',
    label: 'Guest count',
    prompt: 'How many people are you planning for?',
    field: 'guest_count',
    answer_keywords: ['guest', 'guests', 'people', 'attendees', 'person', 'capacity', 'shoppers', 'visitors', 'foot traffic'],
  },
  date_window: {
    id: 'date_window',
    label: 'Date',
    prompt: 'What date or date window are you targeting?',
    field: 'date_window',
    answer_keywords: ['today', 'tomorrow', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  },
  budget_cap_cents: {
    id: 'budget_cap_cents',
    label: 'Budget',
    prompt: 'Do you have a budget ceiling, or should I use market-estimated options?',
    field: 'budget_cap_cents',
    answer_keywords: ['budget', 'under', 'around', '$', 'market estimate', 'not sure', 'do not know'],
  },
  ticketed: {
    id: 'ticketed',
    label: 'Ticketing',
    prompt: 'Is this ticketed, RSVP-only, invite-only, or should guests pay the venue directly?',
    field: 'ticketed',
    answer_keywords: ['ticketed', 'tickets', 'rsvp', 'invite', 'free', 'guests pay', 'external checkout'],
  },
  food_responsibility: {
    id: 'food_responsibility',
    label: 'Food',
    prompt: "Who's handling food and drinks: you, the venue, outside catering, or guests?",
    field: 'food_responsibility',
    answer_keywords: ['food', 'drinks', 'catering', 'venue handles', 'guests pay', 'self', 'organizer', 'snacks', 'bar'],
  },
  setup_format: {
    id: 'setup_format',
    label: 'Room format',
    prompt: 'Should the room be seated, standing, theater-style, classroom-style, hands-on, or a reception layout?',
    field: 'setup_format',
    answer_keywords: ['seated', 'standing', 'mixed', 'theater', 'classroom', 'u shape', 'u-shape', 'hands-on', 'hands on', 'family style', 'reception', 'workstations', 'group seats', 'pregame', 'both'],
  },
  private_or_shared: {
    id: 'private_or_shared',
    label: 'Privacy',
    prompt: 'Private room, semi-private, or okay with a shared space?',
    field: 'private_or_shared',
    answer_keywords: ['private', 'semi private', 'semi-private', 'shared', 'buyout'],
  },
  indoor_outdoor: {
    id: 'indoor_outdoor',
    label: 'Indoor / outdoor',
    prompt: 'Should I prioritize indoor, outdoor, or hybrid spaces?',
    field: 'indoor_outdoor',
    answer_keywords: ['indoor', 'outdoor', 'hybrid', 'patio', 'rooftop', 'rain plan'],
  },
  duration_days: {
    id: 'duration_days',
    label: 'Duration',
    prompt: 'How many days are you planning?',
    field: 'duration_days',
    answer_keywords: ['one day', '1 day', 'two days', '2 days', 'three days', '3 days', 'weekend', 'overnight'],
  },
  duration_minutes: {
    id: 'duration_minutes',
    label: 'Duration',
    prompt: 'How long should I plan for the main event window?',
    field: 'duration_minutes',
    answer_keywords: ['minutes', 'hour', 'hours', '90', '120', 'half day'],
  },
  av_intensity: {
    id: 'av_intensity',
    label: 'AV intensity',
    prompt: 'How much AV should I factor in: light house setup, standard mics/screens, or heavy production?',
    field: 'av_intensity',
    answer_keywords: ['no av', 'light av', 'standard av', 'heavy av', 'production', 'mics', 'screen', 'livestream', 'live stream', 'recording', 'premium sound'],
  },
  stage_required: {
    id: 'stage_required',
    label: 'Stage',
    prompt: 'Do you need a stage or raised speaking area?',
    field: 'stage_required',
    answer_keywords: ['stage', 'raised', 'speaking area', 'no stage', 'podium'],
  },
  demo_stations_needed: {
    id: 'demo_stations_needed',
    label: 'Demo stations',
    prompt: 'Do you need demo stations, product tables, or booth-style setups?',
    field: 'demo_stations_needed',
    answer_keywords: ['demo station', 'demo stations', 'product tables', 'booth', 'booths', 'stations'],
  },
  screens_count: {
    id: 'screens_count',
    label: 'Screens',
    prompt: 'How many screens or projection points do you need?',
    field: 'screens_count',
    answer_keywords: ['screen', 'screens', 'projector', 'projection', 'tv'],
  },
  mics_count: {
    id: 'mics_count',
    label: 'Mics',
    prompt: 'How many microphones do you need?',
    field: 'mics_count',
    answer_keywords: ['mic', 'mics', 'microphone', 'microphones', 'lav', 'handheld'],
  },
  music_format: {
    id: 'music_format',
    label: 'Music',
    prompt: 'Should I plan for a DJ, live music, curated playlist, or no music?',
    field: 'music_format',
    answer_keywords: ['dj', 'live music', 'live band', 'band', 'playlist', 'curated playlist', 'playback', 'no music', 'none'],
  },
  lighting_intensity: {
    id: 'lighting_intensity',
    label: 'Lighting',
    prompt: 'Do you need house lighting, mood lighting, or production lighting?',
    field: 'lighting_intensity',
    answer_keywords: ['house lighting', 'mood lighting', 'production lighting', 'lights', 'lighting'],
  },
  photo_video_priority: {
    id: 'photo_video_priority',
    label: 'Photo / video',
    prompt: 'Do you want photography, video, both, or neither?',
    field: 'photo_video_priority',
    answer_keywords: ['photo', 'photographer', 'video', 'videographer', 'both', 'neither', 'none', 'recap'],
  },
  decor_intensity: {
    id: 'decor_intensity',
    label: 'Decor',
    prompt: 'How much decor or branding should I factor in: none, light, themed, or full production?',
    field: 'decor_intensity',
    answer_keywords: ['decor', 'branding', 'themed', 'full production', 'light decor', 'signage'],
  },
  catering_style: {
    id: 'catering_style',
    label: 'Catering',
    prompt: 'Should food come from the venue, outside catering, self-provided, or a sponsor?',
    field: 'catering_style',
    answer_keywords: ['venue handles', 'outside catering', 'catering', 'self', 'sponsor', 'sponsor provided', 'food', 'snacks'],
  },
  bar_required: {
    id: 'bar_required',
    label: 'Bar',
    prompt: 'Do you need a full bar or beverage program?',
    field: 'bar_required',
    answer_keywords: ['bar', 'full bar', 'drinks', 'cocktails', 'beverage', 'cash bar', 'no bar'],
  },
  security_needs: {
    id: 'security_needs',
    label: 'Security',
    prompt: 'Do you need no security, door staff, or full event security?',
    field: 'security_needs',
    answer_keywords: ['security', 'door', 'door staff', 'bouncer', 'full staff', 'full security', 'none'],
  },
  check_in_needs: {
    id: 'check_in_needs',
    label: 'Check-in',
    prompt: 'Should check-in be walk-in list, ticket scan, or no check-in?',
    field: 'check_in_needs',
    answer_keywords: ['check in', 'check-in', 'walk in list', 'ticket scan', 'guest list', 'registration', 'badges', 'none'],
  },
  sponsor_status: {
    id: 'sponsor_status',
    label: 'Sponsor',
    prompt: 'Is this self-funded, sponsored, or a mixed sponsor/self-funded event?',
    field: 'sponsor_status',
    answer_keywords: ['sponsored', 'sponsor', 'self funded', 'self-funded', 'mixed'],
  },
  preferred_commercial_model: {
    id: 'preferred_commercial_model',
    label: 'Commercial model',
    prompt: 'Do you prefer flat rental, minimum spend, revenue share, package, or a flexible deal?',
    field: 'preferred_commercial_model',
    answer_keywords: ['flat rental', 'minimum spend', 'revenue share', 'bar rev', 'ticket share', 'package', 'flexible'],
  },
}

const FIELD_PROMPT_OVERRIDES: Partial<Record<string, string>> = {
  'workshop_class.setup_format': 'Will this be theater-style with a speaker, or hands-on with workstations?',
  'founder_operator_dinner.private_or_shared': 'Private room, semi-private, or okay with a shared space?',
  'founder_operator_dinner.catering_style': 'Will the venue handle food and bar service, or do you need catering and a bartender separately?',
  'founder_operator_dinner.bar_required': 'Do you need a dedicated bartender or bar setup, or will the venue handle drinks?',
  'founder_operator_dinner.photo_video_priority': 'Do you want a photographer for the evening?',
  'founder_operator_dinner.budget_cap_cents': "What's your budget range — or would you like to model ticket or cover pricing?",
  'hackathon.duration_days': 'How many days are you planning?',
  'nightlife_club_night.music_format': 'Should I plan for DJ, live, or both?',
  'panel_fireside.mics_count': 'How many microphones do you need for the panel?',
}

const AMENITY_QUESTION_COPY: Record<string, Omit<ArchetypeIntakeQuestion, 'source' | 'required' | 'priority'>> = {
  standing_room: {
    id: 'layout_flow',
    label: 'Layout',
    prompt: 'What room flow should I plan for: standing mixer, seated program, open floor, or a mix?',
    answer_keywords: ['standing', 'seated', 'open floor', 'layout', 'room flow', 'mixer'],
  },
  private_room: {
    id: 'privacy',
    label: 'Privacy',
    prompt: 'How private does the space need to be: private room, buyout, semi-private, or shared?',
    answer_keywords: ['private', 'privacy', 'buyout', 'semi-private', 'shared'],
  },
  seated_dining: {
    id: 'seated_service',
    label: 'Seated service',
    prompt: 'Should this be seated dining, passed bites, stations, or a flexible reception layout?',
    field: 'food_responsibility',
    answer_keywords: ['seated', 'dining', 'passed bites', 'stations', 'reception', 'meal'],
  },
  menu: {
    id: 'food_plan',
    label: 'Food',
    prompt: 'What food plan should I match: venue-provided, outside catering, light bites, full meal, or none?',
    field: 'food_responsibility',
    answer_keywords: ['food', 'catering', 'menu', 'meal', 'light bites', 'snacks', 'dinner', 'none'],
  },
  full_bar: {
    id: 'bar_plan',
    label: 'Bar',
    prompt: 'What bar setup do you want: hosted bar, cash bar, minimum spend, or revenue share?',
    field: 'food_responsibility',
    answer_keywords: ['bar', 'hosted bar', 'cash bar', 'minimum spend', 'revenue share', 'drinks'],
  },
  bar: {
    id: 'bar_plan',
    label: 'Bar',
    prompt: 'What bar setup do you want: hosted bar, cash bar, minimum spend, or revenue share?',
    field: 'food_responsibility',
    answer_keywords: ['bar', 'hosted bar', 'cash bar', 'minimum spend', 'revenue share', 'drinks'],
  },
  av: {
    id: 'av_production',
    label: 'AV',
    prompt: 'What AV or production setup do you need: sound, mics, stage, lighting, screen, recording, or livestream?',
    answer_keywords: ['av', 'sound', 'mics', 'microphone', 'microphones', 'stage', 'lighting', 'screen', 'projector', 'recording', 'livestream', 'live stream'],
  },
  foot_traffic: {
    id: 'foot_traffic',
    label: 'Traffic',
    prompt: 'How much walk-up traffic matters, and are you prioritizing street frontage, destination guests, or both?',
    answer_keywords: ['walk-up', 'walk up', 'foot traffic', 'street frontage', 'destination guests'],
  },
  storage: {
    id: 'load_storage',
    label: 'Load-in',
    prompt: 'What load-in, storage, display, and breakdown needs should the space support?',
    answer_keywords: ['load-in', 'load in', 'storage', 'display', 'breakdown', 'setup'],
  },
  tables: {
    id: 'room_setup',
    label: 'Room setup',
    prompt: 'What table, seating, and work-surface setup does the room need?',
    answer_keywords: ['table', 'tables', 'seating', 'work surface', 'workspace', 'classroom'],
  },
  screen: {
    id: 'screen_sound',
    label: 'Screen + sound',
    prompt: 'What screen size, sightlines, and sound setup do you need?',
    answer_keywords: ['screen', 'screens', 'projector', 'tv', 'sightlines', 'sound'],
  },
  premium_sound: {
    id: 'sound_quality',
    label: 'Sound',
    prompt: 'How important is premium sound, DJ equipment, or playback control for this event?',
    answer_keywords: ['premium sound', 'sound', 'speakers', 'dj equipment', 'playback', 'audio'],
  },
  sound_allowed: {
    id: 'sound_quality',
    label: 'Sound',
    prompt: 'What sound level, music format, or DJ setup does the venue need to allow?',
    answer_keywords: ['sound', 'music format', 'dj setup', 'speakers', 'audio', 'sound allowed'],
  },
  sound_system: {
    id: 'sound_quality',
    label: 'Sound',
    prompt: 'What sound system, DJ, or audio setup do you need?',
    answer_keywords: ['sound', 'sound system', 'dj setup', 'audio', 'speakers'],
  },
  sound: {
    id: 'sound_quality',
    label: 'Sound',
    prompt: 'What sound system, DJ, or audio setup do you need?',
    answer_keywords: ['sound', 'sound system', 'dj setup', 'audio', 'speakers'],
  },
  wifi: {
    id: 'tech_basics',
    label: 'Tech',
    prompt: 'What Wi-Fi, power, and tech support should I require from the venue?',
    answer_keywords: ['wifi', 'wi-fi', 'power', 'outlets', 'tech support', 'internet'],
  },
  mics: {
    id: 'av_production',
    label: 'AV',
    prompt: 'What AV or production setup do you need: sound, mics, stage, lighting, screen, recording, or livestream?',
    answer_keywords: ['av', 'mics', 'microphone', 'microphones', 'sound', 'stage', 'recording', 'livestream', 'live stream'],
  },
  screens: {
    id: 'screen_sound',
    label: 'Screen + sound',
    prompt: 'What screen size, sightlines, and sound setup do you need?',
    answer_keywords: ['screen', 'screens', 'projector', 'tv', 'sightlines', 'sound'],
  },
  stage: {
    id: 'av_production',
    label: 'AV',
    prompt: 'What AV or production setup do you need: sound, mics, stage, lighting, screen, recording, or livestream?',
    answer_keywords: ['stage', 'av', 'sound', 'lighting', 'recording', 'livestream', 'live stream'],
  },
  seating: {
    id: 'seating_sightlines',
    label: 'Seating',
    prompt: 'What seating format and sightlines should I plan for?',
    answer_keywords: ['seating', 'seated', 'theater', 'classroom', 'sightlines', 'chairs'],
  },
  networking_area: {
    id: 'layout_flow',
    label: 'Layout',
    prompt: 'What room flow should I plan for: standing mixer, seated program, open floor, or a mix?',
    answer_keywords: ['standing', 'seated', 'open floor', 'layout', 'room flow', 'networking'],
  },
  demo_stations: {
    id: 'demo_production',
    label: 'Demo setup',
    prompt: 'Do you need demo stations, product tables, press moments, or speaking remarks?',
    answer_keywords: ['demo', 'demo stations', 'product tables', 'press', 'remarks', 'speaking'],
  },
  demo_tables: {
    id: 'demo_production',
    label: 'Demo setup',
    prompt: 'Do you need demo stations, product tables, press moments, or speaking remarks?',
    answer_keywords: ['demo', 'demo stations', 'demo tables', 'product tables', 'press', 'remarks', 'speaking'],
  },
  investor_flow: {
    id: 'check_in',
    label: 'Check-in',
    prompt: 'What check-in flow do you need: RSVP list, ticket scan, badges, waivers, or guest-list control?',
    answer_keywords: ['check-in', 'check in', 'ticket scan', 'badges', 'investor', 'guest list', 'registration'],
  },
  photo_moments: {
    id: 'photo_capture',
    label: 'Photo capture',
    prompt: 'Do you need a photographer for recap, sponsor, press, or guest photos?',
    answer_keywords: ['photo', 'photographer', 'press photos', 'recap', 'sponsor photos'],
  },
  power: {
    id: 'tech_basics',
    label: 'Tech',
    prompt: 'What Wi-Fi, power, and tech support should I require from the venue?',
    answer_keywords: ['wifi', 'wi-fi', 'power', 'outlets', 'tech support', 'internet'],
  },
  breakout_rooms: {
    id: 'breakout_rooms',
    label: 'Breakouts',
    prompt: 'Do you need breakout rooms, quiet rooms, or separate work zones?',
    answer_keywords: ['breakout', 'breakout rooms', 'quiet rooms', 'work zones', 'separate rooms'],
  },
  flexible_layout: {
    id: 'layout_flow',
    label: 'Layout',
    prompt: 'What room flow should I plan for: standing mixer, seated program, open floor, or a mix?',
    answer_keywords: ['standing', 'seated', 'open floor', 'layout', 'room flow', 'flexible'],
  },
  donor_flow: {
    id: 'check_in',
    label: 'Check-in',
    prompt: 'What check-in flow do you need: RSVP list, ticket scan, badges, waivers, or guest-list control?',
    answer_keywords: ['check-in', 'check in', 'donor', 'ticket scan', 'badges', 'guest list', 'registration'],
  },
  sponsor_visibility: {
    id: 'decor_branding',
    label: 'Decor',
    prompt: 'What decor, branding, staging, or sponsor visibility needs should the venue support?',
    answer_keywords: ['decor', 'branding', 'staging', 'signage', 'sponsor', 'visibility'],
  },
  seated_or_reception_space: {
    id: 'layout_flow',
    label: 'Layout',
    prompt: 'What room flow should I plan for: standing mixer, seated program, open floor, or a mix?',
    answer_keywords: ['standing', 'seated', 'reception', 'layout', 'room flow', 'open floor'],
  },
  outdoor_vibe: {
    id: 'weather_plan',
    label: 'Weather plan',
    prompt: 'Does this need to be indoor-only, outdoor, or have a rain plan?',
    answer_keywords: ['rain plan', 'weather', 'indoor', 'outdoor', 'patio', 'rooftop', 'backup'],
  },
  load_in: {
    id: 'operational_timing',
    label: 'Prep time',
    prompt: 'What setup, load-in, sound-check, and breakdown window should I plan around?',
    answer_keywords: ['prep', 'load-in', 'load in', 'setup', 'sound check', 'breakdown', 'doors open'],
  },
  loading_access: {
    id: 'operational_timing',
    label: 'Prep time',
    prompt: 'What setup, load-in, sound-check, and breakdown window should I plan around?',
    answer_keywords: ['prep', 'load-in', 'load in', 'setup', 'sound check', 'breakdown', 'doors open'],
  },
  permits: {
    id: 'permits',
    label: 'Permits',
    prompt: 'Do you need permits, sidewalk use, park permission, sampling approval, or vending clearance?',
    answer_keywords: ['permit', 'permits', 'sidewalk', 'park permission', 'sampling', 'vending clearance'],
  },
  pos: {
    id: 'pos_data',
    label: 'POS',
    prompt: 'Do you need POS, lead capture, ticket scan, or sales reporting for this event?',
    answer_keywords: ['pos', 'lead capture', 'sales reporting', 'ticket scan', 'checkout'],
  },
  security_plan: {
    id: 'security',
    label: 'Security',
    prompt: 'Do you need security, door staff, crowd control, or guest-list enforcement?',
    answer_keywords: ['security', 'door staff', 'crowd control', 'guest list', 'guest-list', 'bouncer'],
  },
  vip_area: {
    id: 'vip_guest_flow',
    label: 'VIP area',
    prompt: 'Do you need artist, VIP, green-room, or guest-list control for this event?',
    answer_keywords: ['vip', 'artist', 'green room', 'green-room', 'guest list', 'guest-list'],
  },
  sightlines: {
    id: 'screen_sound',
    label: 'Screen + sound',
    prompt: 'What screen size, sightlines, and sound setup do you need?',
    answer_keywords: ['screen', 'screens', 'projector', 'tv', 'sightlines', 'sound'],
  },
  route_or_space: {
    id: 'route_space',
    label: 'Route / space',
    prompt: 'Do you have a route, studio, park, or workout space in mind, or should I suggest one?',
    answer_keywords: ['route', 'studio', 'park', 'workout space', 'space', 'start point'],
  },
  rain_plan: {
    id: 'weather_plan',
    label: 'Weather plan',
    prompt: 'Does this need to be indoor-only, outdoor, or have a rain plan?',
    answer_keywords: ['rain plan', 'weather', 'indoor', 'outdoor', 'backup'],
  },
  group_seats_or_screens: {
    id: 'external_tickets',
    label: 'Tickets / seats',
    prompt: 'Do you need group seats, external ticket checkout, screens, or both?',
    answer_keywords: ['group seats', 'seats', 'external ticket', 'checkout', 'screens', 'tickets'],
  },
  pre_post_venue: {
    id: 'pre_post_plan',
    label: 'Before / after',
    prompt: 'Do you want food or drinks before, during, or after the game?',
    answer_keywords: ['pregame', 'postgame', 'before', 'after', 'dinner', 'drinks', 'bar'],
  },
  privacy: {
    id: 'privacy',
    label: 'Privacy',
    prompt: 'How private does the space need to be: private room, buyout, semi-private, or shared?',
    answer_keywords: ['private', 'privacy', 'buyout', 'semi-private', 'shared'],
  },
  meals: {
    id: 'food_plan',
    label: 'Food',
    prompt: 'What food plan should I match: venue-provided, outside catering, light bites, full meal, or none?',
    field: 'food_responsibility',
    answer_keywords: ['food', 'catering', 'meal', 'meals', 'light bites', 'snacks', 'none'],
  },
  catering: {
    id: 'food_plan',
    label: 'Food',
    prompt: 'What food plan should I match: venue-provided, outside catering, light bites, full meal, or none?',
    field: 'food_responsibility',
    answer_keywords: ['food', 'catering', 'meal', 'meals', 'light bites', 'snacks', 'none'],
  },
  seasonal_availability: {
    id: 'seasonal_availability',
    label: 'Date flexibility',
    prompt: 'Are your dates flexible around peak-season venue availability, or is the date fixed?',
    answer_keywords: ['flexible date', 'dates flexible', 'date fixed', 'date is fixed', 'fixed date', 'peak season', 'holiday'],
  },
  rooms: {
    id: 'overnight_rooms',
    label: 'Rooms',
    prompt: 'Do you need guest rooms, meeting rooms, private rooms, or all of those?',
    answer_keywords: ['guest rooms', 'meeting rooms', 'private rooms', 'rooms', 'hotel block'],
  },
  late_hours: {
    id: 'late_hours',
    label: 'Hours',
    prompt: 'What event hours, door time, and venue curfew should I plan around?',
    answer_keywords: ['late', 'door time', 'doors', 'curfew', 'hours', 'end time'],
  },
}

const COMMERCIAL_QUESTION_COPY: Partial<Record<CommercialModel, Omit<ArchetypeIntakeQuestion, 'source' | 'required' | 'priority'>>> = {
  bar_rev_share: {
    id: 'venue_terms',
    label: 'Venue terms',
    prompt: 'Do you prefer minimum spend, flat rental, bar revenue share, per-head kickback, or a flexible venue deal?',
    field: 'venue_terms',
    answer_keywords: ['minimum spend', 'flat rental', 'bar revenue', 'revenue share', 'rev share', 'kickback', 'per-head', 'per head'],
  },
  door_split: {
    id: 'venue_terms',
    label: 'Venue terms',
    prompt: 'Do you want a door split, bar revenue share, flat rental, or minimum spend?',
    field: 'venue_terms',
    answer_keywords: ['door split', 'bar revenue', 'revenue share', 'flat rental', 'minimum spend'],
  },
  ticket_split: {
    id: 'venue_terms',
    label: 'Venue terms',
    prompt: 'Do you want a ticket split, flat rental, minimum spend, or bar revenue share?',
    field: 'venue_terms',
    answer_keywords: ['ticket split', 'flat rental', 'minimum spend', 'bar revenue', 'revenue share'],
  },
  ticket_share: {
    id: 'venue_terms',
    label: 'Venue terms',
    prompt: 'Do you want a ticket split, flat rental, minimum spend, or bar revenue share?',
    field: 'venue_terms',
    answer_keywords: ['ticket split', 'ticket share', 'flat rental', 'minimum spend', 'bar revenue'],
  },
  external_checkout: {
    id: 'external_tickets',
    label: 'Tickets / seats',
    prompt: 'What external checkout or group-ticket path should I use, and what seat budget or section should I target?',
    answer_keywords: ['external checkout', 'group tickets', 'seat budget', 'section', 'ticket link', 'seats'],
  },
  package: {
    id: 'venue_terms',
    label: 'Venue terms',
    prompt: 'Do you want a per-person package, flat rental, or minimum-spend venue deal?',
    field: 'venue_terms',
    answer_keywords: ['package', 'per-person', 'per person', 'flat rental', 'minimum spend'],
  },
}

export function buildArchetypeIntakeQuestions(
  archetype: EventArchetypeConfig,
  options: { includeRecommended?: boolean } = {}
): ArchetypeIntakeQuestion[] {
  const questions: ArchetypeIntakeQuestion[] = []

  archetype.matching_fields.critical.forEach((field, index) => {
    const copy = buildMatchingFieldQuestionCopy(archetype, field)
    if (!copy) return
    questions.push({
      ...copy,
      source: 'matching_field',
      required: true,
      priority: 20 + index,
    })
  })

  if (options.includeRecommended) {
    archetype.matching_fields.high_signal.forEach((field, index) => {
      const copy = buildMatchingFieldQuestionCopy(archetype, field)
      if (!copy) return
      questions.push({
        ...copy,
        source: 'matching_field',
        required: false,
        priority: 60 + index,
      })
    })
  }

  return dedupeQuestions(questions).sort((first, second) => first.priority - second.priority)
}

function buildMatchingFieldQuestionCopy(
  archetype: EventArchetypeConfig,
  field: MatchingField
): Omit<ArchetypeIntakeQuestion, 'source' | 'required' | 'priority'> | null {
  const copy = MATCHING_FIELD_QUESTION_COPY[field]
  if (!copy) return null
  const prompt = FIELD_PROMPT_OVERRIDES[`${archetype.key}.${field}`] ?? copy.prompt
  return {
    ...copy,
    id: field,
    prompt,
    answer_keywords: [
      ...copy.answer_keywords,
      field.replace(/_/g, ' '),
      serializeDefaultFill(archetype.default_fills[field]),
    ].filter((value): value is string => Boolean(value)),
  }
}

export function buildArchetypeQuestionPriority(input: {
  archetype: EventArchetypeConfig
  plan?: PlanLike | null
  conversationText: string
}): {
  critical_missing: MatchingField[]
  high_signal_missing: MatchingField[]
  archetype_vendor_stack: EventArchetypeConfig['vendor_stack']
} {
  const criticalMissing = input.archetype.matching_fields.critical.filter((field) => (
    !canDefaultSatisfyCritical(input.archetype, field) &&
    !isMatchingFieldAnswered(input.archetype, field, input.plan ?? null, input.conversationText)
  ))
  const highSignalMissing = input.archetype.matching_fields.high_signal.filter((field) => (
    !isMatchingFieldAnswered(input.archetype, field, input.plan ?? null, input.conversationText)
  ))

  return {
    critical_missing: criticalMissing,
    high_signal_missing: highSignalMissing,
    archetype_vendor_stack: input.archetype.vendor_stack,
  }
}

export function isMatchingFieldAnswered(
  archetype: EventArchetypeConfig,
  field: MatchingField,
  plan: PlanLike | null,
  conversationText: string
): boolean {
  if (isPlanFieldAnswered(field, plan)) return true

  const question = buildMatchingFieldQuestionCopy(archetype, field)
  if (!question) return false
  const normalizedQuestion: ArchetypeIntakeQuestion = {
    ...question,
    source: 'matching_field',
    required: true,
    priority: 0,
  }
  if (isQuestionMarkedAnswered(normalizedQuestion, plan?.metadata)) return true

  return isQuestionAnsweredByText(normalizedQuestion, normalizeText(conversationText))
}

function serializeDefaultFill(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function buildArchetypeIntakeQuestionsFromLegacySources(
  archetype: EventArchetypeConfig,
  options: { includeRecommended?: boolean } = {}
): ArchetypeIntakeQuestion[] {
  const questions: ArchetypeIntakeQuestion[] = []

  archetype.vendor_stack.forEach((item, index) => {
    if (item.necessity === 'optional') return
    if (item.necessity === 'recommended' && !options.includeRecommended) return
    const copy = SERVICE_QUESTION_COPY[item.service_type]
    if (!copy) return
    questions.push({
      ...copy,
      source: 'vendor_stack',
      required: item.necessity === 'required',
      priority: item.necessity === 'required' ? 20 + index : 60 + index,
    })
  })

  archetype.required_amenities.forEach((amenity, index) => {
    const copy = AMENITY_QUESTION_COPY[amenity]
    if (!copy) return
    questions.push({
      ...copy,
      source: 'required_amenity',
      required: true,
      priority: 30 + index,
    })
  })

  archetype.preferred_commercial_models.forEach((model, index) => {
    const copy = COMMERCIAL_QUESTION_COPY[model]
    if (!copy) return
    questions.push({
      ...copy,
      source: 'commercial_model',
      required: model === 'external_checkout',
      priority: model === 'external_checkout' ? 35 + index : 70 + index,
    })
  })

  return dedupeQuestions(questions).sort((first, second) => first.priority - second.priority)
}

export function buildArchetypeIntakeQuestionBrief(archetype: EventArchetypeConfig): ArchetypeIntakeQuestion[] {
  return buildArchetypeIntakeQuestions(archetype, { includeRecommended: true })
}

export function getNextArchetypeIntakeQuestion(input: NextQuestionInput): ArchetypeIntakeQuestion | null {
  const archetype = resolveInputArchetype(input)
  if (!archetype) return null
  const priority = buildArchetypeQuestionPriority({
    archetype,
    plan: input.plan ?? null,
    conversationText: input.conversationText,
  })
  const questions = buildArchetypeIntakeQuestions(archetype, { includeRecommended: input.includeRecommended })

  const criticalQuestion = questions.find((question) =>
    question.field &&
    priority.critical_missing.includes(question.field as MatchingField)
  )
  if (criticalQuestion) return criticalQuestion

  if (input.includeRecommended === true) {
    const hasAnsweredArchetypeSpecificCritical = archetype.matching_fields.critical.some((field) =>
      !UNIVERSAL_MATCHING_FIELDS.has(field) &&
      (canDefaultSatisfyCritical(archetype, field) || isMatchingFieldAnswered(archetype, field, input.plan ?? null, input.conversationText))
    )
    if (hasAnsweredArchetypeSpecificCritical) return null

    const hasAnsweredAnyHighSignal = archetype.matching_fields.high_signal.some((field) =>
      HIGH_SIGNAL_PIVOT_FIELDS.has(field) &&
      isMatchingFieldAnswered(archetype, field, input.plan ?? null, input.conversationText)
    )
    if (hasAnsweredAnyHighSignal) return null

    return questions.find((question) =>
      question.field &&
      priority.high_signal_missing.includes(question.field as MatchingField)
    ) ?? null
  }

  return null
}

export function sanitizeIntakeQuestionCandidate(candidate: string | null | undefined): string | null {
  const question = candidate?.trim()
  if (!question) return null

  const normalized = normalizeText(question).replace(/\s+/g, '_')
  if (matchingFieldSchema.safeParse(normalized).success) return null
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(question)) return null

  const looksLikeQuestion =
    /[?？]$/.test(question) ||
    /\b(what|which|who|how|when|where|do|does|did|is|are|will|would|should|can|could)\b/i.test(question)

  return looksLikeQuestion ? question : null
}

const UNIVERSAL_MATCHING_FIELDS = new Set<MatchingField>([
  'event_type',
  'neighborhood',
  'guest_count',
  'date_window',
])

const HIGH_SIGNAL_PIVOT_FIELDS = new Set<MatchingField>([
  'setup_format',
  'private_or_shared',
  'indoor_outdoor',
  'duration_days',
  'duration_minutes',
  'av_intensity',
  'stage_required',
  'demo_stations_needed',
  'screens_count',
  'mics_count',
  'music_format',
  'lighting_intensity',
  'photo_video_priority',
  'decor_intensity',
  'catering_style',
  'bar_required',
  'security_needs',
  'check_in_needs',
  'sponsor_status',
  'preferred_commercial_model',
])

export function hasAnsweredRequiredArchetypeQuestions(input: NextQuestionInput): boolean {
  const archetype = resolveInputArchetype(input)
  if (!archetype) return true
  return buildArchetypeQuestionPriority({
    archetype,
    plan: input.plan ?? null,
    conversationText: input.conversationText,
  }).critical_missing.length === 0
}

export function buildArchetypeAnswerText(
  messages: ConversationMessageLike[],
  extraText: Array<string | null | undefined> = []
): string {
  const sortedMessages = [...messages].sort((first, second) =>
    (first.created_at ?? '').localeCompare(second.created_at ?? '')
  )
  const answerLines: string[] = []

  sortedMessages.forEach((message, index) => {
    if (message.role !== 'user') return

    const previousAgentMessage = findPreviousAgentMessage(sortedMessages, index)
    const previousQuestionText = readArchetypeQuestionText(previousAgentMessage?.metadata)
    if (previousQuestionText && isShortContextualAnswer(message.content)) {
      answerLines.push(`${previousQuestionText} ${message.content}`)
      return
    }

    answerLines.push(message.content)
  })

  extraText.forEach((value) => {
    if (value && value.trim().length > 0) answerLines.push(value)
  })

  return answerLines.join('\n')
}

export function isArchetypeQuestionAnswered(
  question: ArchetypeIntakeQuestion,
  plan: PlanLike | null,
  conversationText: string
): boolean {
  if (isQuestionMarkedAnswered(question, plan?.metadata)) return true
  if (question.field && isPlanFieldAnswered(question.field, plan)) return true

  const normalized = normalizeText(conversationText)
  return isQuestionAnsweredByText(question, normalized)
}

export function findAnsweredArchetypeQuestionForPrompt(input: NextQuestionInput & {
  prompt: string | null | undefined
}): ArchetypeIntakeQuestion | null {
  const prompt = input.prompt?.trim()
  if (!prompt) return null

  const archetype = resolveInputArchetype(input)
  if (!archetype) return null

  const normalizedPrompt = normalizeText(prompt)
  const questions = buildArchetypeIntakeQuestions(archetype, { includeRecommended: true })

  return questions.find((question) =>
    doesPromptLookLikeQuestion(normalizedPrompt, question) &&
    isArchetypeQuestionAnswered(question, input.plan ?? null, input.conversationText)
  ) ?? null
}

export function mergeAnsweredArchetypeQuestionMetadata(
  metadata: unknown,
  input: NextQuestionInput & {
    userMessage: string
    now?: string
  }
): Record<string, unknown> {
  const archetype = resolveInputArchetype(input)
  const existingMetadata = readRecord(metadata) ?? {}
  if (!archetype) return existingMetadata

  const currentAnswers = readRecord(existingMetadata[ANSWERED_ARCHETYPE_QUESTIONS_METADATA_KEY]) ?? {}
  const nextAnswers: Record<string, unknown> = { ...currentAnswers }
  const normalizedMessage = normalizeText(input.userMessage)
  const pendingQuestion = readPendingQuestion(existingMetadata[PENDING_ARCHETYPE_QUESTION_METADATA_KEY])
  const now = input.now ?? new Date().toISOString()

  for (const question of buildArchetypeIntakeQuestions(archetype, { includeRecommended: true })) {
    const answeredByDirectText = isQuestionAnsweredByText(question, normalizedMessage)
    const answeredByContext =
      pendingQuestion?.id === question.id &&
      isShortContextualAnswer(input.userMessage)

    if (!answeredByDirectText && !answeredByContext) continue

    nextAnswers[question.id] = {
      id: question.id,
      label: question.label,
      prompt: question.prompt,
      answered_at: now,
      source: answeredByContext ? 'contextual_reply' : 'message_text',
    }
  }

  if (Object.keys(nextAnswers).length === Object.keys(currentAnswers).length) {
    return existingMetadata
  }

  return {
    ...existingMetadata,
    [ANSWERED_ARCHETYPE_QUESTIONS_METADATA_KEY]: nextAnswers,
  }
}

function isPlanFieldAnswered(field: string, plan: PlanLike | null): boolean {
  if (!plan) return false

  if (field === 'event_type') return Boolean(plan.event_type)
  if (field === 'neighborhood') return Boolean((plan as PlanLike & { neighborhood?: string | null }).neighborhood)
  if (field === 'guest_count') return typeof (plan as PlanLike & { guest_count?: unknown }).guest_count === 'number'
  if (field === 'date_window') {
    const dateStart = (plan as PlanLike & { date_window_start?: string | null }).date_window_start
    const dateEnd = (plan as PlanLike & { date_window_end?: string | null }).date_window_end
    return Boolean(dateStart || dateEnd)
  }
  if (field === 'budget_cap_cents') {
    return typeof (plan as PlanLike & { budget_cap_cents?: unknown }).budget_cap_cents === 'number'
  }
  if (field === 'ticketed') {
    // `plans.ticketed` defaults false for persistence, so the boolean alone
    // does not prove the organizer answered the ticketing question. Treat it
    // as answered only once a ticketing model or explicit metadata signal exists.
    if (typeof plan.ticketing_model === 'string' && plan.ticketing_model.trim().length > 0) return true
    const metadata = readRecord(plan.metadata)
    const value = readMatchingFieldFromMetadata(metadata, field)
    return typeof value === 'boolean'
  }
  if (field === 'food_responsibility') return Boolean(plan.food_responsibility)
  if (field === 'ticketing_model') return typeof plan.ticketing_model === 'string' && plan.ticketing_model.trim().length > 0
  if (field === 'venue_terms') return typeof plan.venue_terms === 'string' && plan.venue_terms.trim().length > 0
  if (field === 'agent_action') return typeof plan.agent_action === 'string' && plan.agent_action.trim().length > 0

  const metadata = readRecord(plan.metadata)
  const value = readMatchingFieldFromMetadata(metadata, field)
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return value !== null && value !== undefined
}

function canDefaultSatisfyCritical(archetype: EventArchetypeConfig, field: MatchingField): boolean {
  return DEFAULTABLE_CRITICAL_FIELDS.has(field) &&
    archetype.default_fills[field] !== undefined &&
    archetype.default_fills[field] !== null
}

const DEFAULTABLE_CRITICAL_FIELDS = new Set<MatchingField>([
  'stage_required',
  'mics_count',
  'screens_count',
])

function readMatchingFieldFromMetadata(metadata: Record<string, unknown> | null, field: string): unknown {
  if (!metadata) return null
  const direct = metadata[field]
  if (direct !== undefined && direct !== null) return direct
  const matchingSignals = readRecord(metadata.matching_signals)
  if (matchingSignals?.[field] !== undefined && matchingSignals?.[field] !== null) return matchingSignals[field]
  const eventRequirements = readRecord(metadata.event_requirements)
  if (eventRequirements?.[field] !== undefined && eventRequirements?.[field] !== null) return eventRequirements[field]
  return null
}

function isQuestionMarkedAnswered(question: ArchetypeIntakeQuestion, metadata: unknown): boolean {
  const answers = readRecord(readRecord(metadata)?.[ANSWERED_ARCHETYPE_QUESTIONS_METADATA_KEY])
  return Boolean(readRecord(answers?.[question.id]))
}

function resolveInputArchetype(input: NextQuestionInput): EventArchetypeConfig | null {
  if (input.archetype) return input.archetype

  const rawEventType = input.eventType ?? input.plan?.event_type ?? null
  if (!rawEventType) return null

  const key = resolveArchetypeKey(rawEventType)
  return getArchetypeByKey(key) ?? null
}

function findPreviousAgentMessage(
  messages: ConversationMessageLike[],
  userMessageIndex: number
): ConversationMessageLike | null {
  for (let index = userMessageIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'agent') return messages[index]
  }
  return null
}

function isShortContextualAnswer(value: string): boolean {
  return /^(yes|yeah|yep|yup|sure|correct|no|nope|none|not sure|maybe|tbd|bring our own|we have one|we need one|shared is okay|shared is fine|semi-private is okay|semi-private is fine)\b/i
    .test(value.trim())
}

function readArchetypeQuestionText(metadata: unknown): string | null {
  const record = readRecord(metadata)
  const question = readRecord(record?.archetype_question)
  if (!question) return null

  return [
    readString(question.id),
    readString(question.label),
    readString(question.prompt),
  ].filter((value): value is string => Boolean(value)).join(' ')
}

function dedupeQuestions(questions: ArchetypeIntakeQuestion[]): ArchetypeIntakeQuestion[] {
  const byId = new Map<string, ArchetypeIntakeQuestion>()

  for (const question of questions) {
    const existing = byId.get(question.id)
    if (!existing) {
      byId.set(question.id, question)
      continue
    }

    byId.set(question.id, {
      ...existing,
      required: existing.required || question.required,
      priority: Math.min(existing.priority, question.priority),
      answer_keywords: Array.from(new Set([...existing.answer_keywords, ...question.answer_keywords])),
    })
  }

  return Array.from(byId.values())
}

function phraseMatches(normalizedText: string, normalizedPhrase: string): boolean {
  if (!normalizedPhrase) return false
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(normalizedText)
}

function isQuestionAnsweredByText(question: ArchetypeIntakeQuestion, normalizedText: string): boolean {
  return question.answer_keywords.some((keyword) => phraseMatches(normalizedText, normalizeText(keyword)))
}

function doesPromptLookLikeQuestion(normalizedPrompt: string, question: ArchetypeIntakeQuestion): boolean {
  const normalizedQuestionPrompt = normalizeText(question.prompt)
  if (
    normalizedQuestionPrompt &&
    (normalizedPrompt.includes(normalizedQuestionPrompt) || normalizedQuestionPrompt.includes(normalizedPrompt))
  ) {
    return true
  }

  const normalizedLabel = normalizeText(question.label)
  if (normalizedLabel && phraseMatches(normalizedPrompt, normalizedLabel)) return true

  const keywordHits = question.answer_keywords.filter((keyword) =>
    phraseMatches(normalizedPrompt, normalizeText(keyword))
  ).length

  return keywordHits >= 2
}

function readPendingQuestion(value: unknown): Pick<ArchetypeIntakeQuestion, 'id' | 'label' | 'prompt'> | null {
  const record = readRecord(value)
  const id = readString(record?.id)
  const label = readString(record?.label)
  const prompt = readString(record?.prompt)
  if (!id || !label || !prompt) return null
  return { id, label, prompt }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
