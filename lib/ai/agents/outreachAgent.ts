import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const outreachTypeSchema = z.enum([
  'venue_inquiry',
  'vendor_inquiry',
  'follow_up',
  'sponsor_inquiry',
])

export const targetPartnerSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['venue', 'vendor', 'sponsor']),
  contact_name: z.string().trim().min(1).nullable().optional(),
  contact_email: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().min(1).nullable().optional(),
  contact_info: z.record(z.unknown()).nullable().optional(),
}).passthrough()

export const outreachAgentInputSchema = z.object({
  event_plan: eventPlanSchema,
  target_partner: targetPartnerSchema,
  outreach_type: outreachTypeSchema,
  channel: z.enum(['email', 'instagram', 'sms', 'voice']).default('email'),
  organizer_preferences: z.record(z.unknown()).nullish(),
  previous_thread_summary: z.string().trim().min(1).nullish(),
})

export const outreachAgentOutputSchema = z.object({
  channel: z.enum(['email', 'instagram', 'sms', 'voice']).optional(),
  subject: z.string().trim().min(1).nullable().optional(),
  message_body: z.string().trim().min(1),
  voice_script: z.string().trim().min(1).nullable().optional(),
  key_questions: z.array(z.string().trim().min(1)).optional(),
  max_call_duration_seconds: z.number().int().positive().max(600).nullable().optional(),
  requested_info: z.array(z.string().trim().min(1)),
  follow_up_date_suggestion: z.string().trim().min(1).nullable(),
  tone: z.string().trim().min(1),
  approval_required: z.literal(true),
})

export type OutreachAgentInput = z.input<typeof outreachAgentInputSchema>
export type OutreachAgentOutput = z.infer<typeof outreachAgentOutputSchema>
export type OutreachAgentResult = AgentResult<OutreachAgentOutput>

export const outreachAgentDefinition = {
  agentName: 'outreach',
  model: 'gpt-4o',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const OUTREACH_OUTPUT_CONTRACT = {
  channel: 'email | instagram | sms | voice',
  subject: 'string',
  message_body: 'string',
  voice_script: 'string or null',
  key_questions: ['string'],
  max_call_duration_seconds: 'number or null',
  requested_info: ['string'],
  follow_up_date_suggestion: 'string or null',
  tone: 'string',
  approval_required: true,
}

const OUTREACH_VOICE_RULES = [
  'Write as the creator, not as an assistant. The email is from the creator to the venue or vendor. Never refer to "the planner", "my client", "we at <platform>", or any third party between the creator and the recipient.',
  'Never identify AI, agents, automated tooling, 3rdSpace, or 3rdPlace anywhere in the subject or body.',
  'Sound like a busy human event organizer. No marketing phrases, no exclamation marks, no emoji. Avoid filler words like "delve", "navigate", "tapestry", "ecosystem", "leverage", "synergy".',
  'Keep the message body 4 to 6 short paragraphs (or 4-6 sentences for follow-ups). No greeting fluff like "I hope this email finds you well". Open with the ask or the concrete event context.',
  'Pick one specific detail about the recipient when something specific is provided in target_partner.contact_info or organizer_preferences (a neighborhood, a venue feature, a service specialty). Do not invent details that are not in the input.',
  'Close by stating that nothing is booked or committed yet, and sign off with the creator\'s first name only when a creator_display_name is provided. Otherwise omit a sign-off name.',
].join('\n')

const OUTREACH_SUBJECT_RULES = [
  'Subject line format when an event date is known: "[Month Day] — [N]-person [event type] — [identity]". Example: "Sep 12 — 40-person founder dinner — Over the Top".',
  'Identity comes from organizer_preferences.sender_identity if present; otherwise organizer_preferences.creator_display_name; otherwise omit the identity segment and the preceding em dash.',
  'For outreach_type "follow_up", prepend "Following up — " to the original subject and do not change the rest. Do not start a new thread or invent a new subject.',
  'Include budget in the subject ONLY when both (a) organizer_preferences.budget_signal_in_subject is true and (b) a budget figure is available. Append it as ", $XK range" after the event type (e.g. "Sep 12 — 40-person founder dinner, $3K range — Over the Top"). Otherwise mention budget only in the body.',
  'Never include the platform name, emoji, all-caps words, or generic words like "Inquiry", "Request", "Question", "Quick question", "Hello".',
  'Never start the subject with "Re:" unless outreach_type is follow_up.',
  'Use an em dash (—), not a hyphen, between segments.',
].join('\n')

const OUTREACH_STYLE_EXAMPLES = JSON.stringify({
  venue_inquiry: {
    subject: 'Sep 12 — 40-person founder dinner — Over the Top',
    message_body: 'Hi The Loft team,\n\nI run Over the Top, a Bay Area founder dinner series, and I am scoping a 40-person seated dinner for the evening of Sep 12. Saw your space on the Mission listing — the long communal table is the format we use, and the natural light into early evening fits the vibe we are after.\n\nBudget target is around $3,000 for a 4-hour buyout, BYO catering if you allow it. Could you confirm availability that night, pricing and deposit terms, and any house rules around outside food or alcohol?\n\nNothing is booked or committed on our side yet — I am trying to lock in the date before I confirm catering. Happy to send a fuller brief if useful.\n\nThanks,\nSarah',
    requested_info: ['Availability for Sep 12 evening', 'Pricing and deposit terms for a 4-hour buyout', 'House rules on outside catering and alcohol'],
    follow_up_date_suggestion: '2026-06-08',
    tone: 'warm-professional',
    approval_required: true,
  },
  vendor_inquiry: {
    subject: 'Sep 12 — DJ for 40-person founder dinner — Over the Top',
    message_body: 'Hi Marcus,\n\nI am planning a 40-person seated dinner on Sep 12 in the Mission for the Over the Top series and looking for a DJ for cocktail hour through dinner — roughly 6:30 to 10:30 PM. Vibe is upscale-casual, mostly 90s and 2000s hip hop and R&B sliding into deeper house as the evening goes.\n\nLikely venue is The Loft (still confirming). House sound system. Budget for the slot is $800-1,200.\n\nAre you open that night? If so, a quick quote and what you would need from us setup-wise would be great.\n\nThanks,\nSarah',
    requested_info: ['Availability for evening of Sep 12', 'Quote and setup requirements', 'Equipment provided vs. required from venue'],
    follow_up_date_suggestion: '2026-06-08',
    tone: 'warm-professional',
    approval_required: true,
  },
  follow_up: {
    subject: 'Following up — Sep 12 — 40-person founder dinner — Over the Top',
    message_body: 'Hi The Loft team,\n\nCircling back on the note below — wanted to check if Sep 12 is still open before I look at a backup date. Happy to jump on a quick call if easier.\n\nThanks,\nSarah',
    requested_info: ['Availability for Sep 12 evening', 'Pricing and deposit terms'],
    follow_up_date_suggestion: '2026-06-15',
    tone: 'warm-direct',
    approval_required: true,
  },
}, null, 2)

const OUTREACH_SYSTEM_PROMPT = [
  'You are the 3rdSpace Outreach Agent.',
  'Generate concise, human-sounding outreach drafts to venues, vendors, and sponsors on behalf of a creator (event organizer).',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The generated message is only a draft for human approval. Never send email, create bookings, authorize payments, or make commitments.',
  'approval_required must always be exactly true.',
  'Include the event date when known, expected_attendance when known, event_name when known, budget range or budget when available, food/drink needs when available in organizer_preferences, and a specific ask for availability, pricing, minimums, or next details.',
  'Do not overpromise payment, booking, final attendance, exclusivity, or confirmed terms.',
  'If a fact is unknown, ask for it or phrase it as to be confirmed. Do not invent confirmed facts.',
  'Respect input.channel. For email include a useful subject. For sms set subject to null and write 1-2 short sentences. For instagram set subject to null and write a 2-3 sentence DM. For voice set subject to null, include voice_script, key_questions, max_call_duration_seconds, and disclose that this is an automated assistant calling on behalf of the creator.',
  'Every SMS draft should be short; the system appends opt-out copy at send time.',
  'The voice script must never pretend to be human.',
  '',
  '## Voice rules',
  OUTREACH_VOICE_RULES,
  '',
  '## Subject line rules',
  OUTREACH_SUBJECT_RULES,
  '',
  '## Stylistic anchors (format reference only — do not copy verbatim)',
  OUTREACH_STYLE_EXAMPLES,
  '',
  `Output JSON must match this contract: ${JSON.stringify(OUTREACH_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runOutreachAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<OutreachAgentResult> {
  const startedAt = Date.now()
  const input = outreachAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: OUTREACH_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: outreachAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, outreachAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('outreach returned an empty model response', metadata)
  }

  let output: OutreachAgentOutput
  try {
    output = outreachAgentOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: outreachAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse outreach model JSON'
}

function parseJsonObject(content: string): unknown {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model response was not a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse outreach model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse outreach model JSON')
  }
}
