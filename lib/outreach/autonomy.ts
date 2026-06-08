import { z } from 'zod'

export const outreachAutonomousActionSchema = z.enum([
  'send_first_contact',
  'send_follow_up',
  'send_reply',
  'schedule_follow_up',
  'book',
  'pay',
  'refund',
  'change_terms',
  'import_contacts',
])

export const outreachAutonomyPolicySchema = z.object({
  id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  version: z.number().int().positive().default(1),
  allowed_autonomous_actions: z.array(outreachAutonomousActionSchema).default([]),
  irreversible_autonomous_actions: z.array(outreachAutonomousActionSchema).default([]),
  require_approval_for_first_contact: z.boolean().default(true),
  max_followups_per_thread: z.number().int().nonnegative().default(0),
  max_inquiries_per_event: z.number().int().nonnegative().default(0),
  max_unattended_budget_cents: z.number().int().nonnegative().default(0),
  trust_level: z.number().int().min(0).max(100).default(0),
  blacklisted_keywords: z.array(z.string()).default([]),
  blacklisted_venue_ids: z.array(z.string().uuid()).default([]),
  quiet_hours_start_local: z.string().nullable().default(null),
  quiet_hours_end_local: z.string().nullable().default(null),
})

export type OutreachAutonomousAction = z.infer<typeof outreachAutonomousActionSchema>
export type OutreachAutonomyPolicy = z.infer<typeof outreachAutonomyPolicySchema>

export const irreversibleOutreachActions = new Set<OutreachAutonomousAction>([
  'book',
  'pay',
  'refund',
  'change_terms',
  'import_contacts',
])

export const defaultOutreachAutonomyPolicy: OutreachAutonomyPolicy = outreachAutonomyPolicySchema.parse({
  allowed_autonomous_actions: [],
  irreversible_autonomous_actions: [],
  require_approval_for_first_contact: true,
})

export function normalizeOutreachAutonomyPolicy(value: unknown): OutreachAutonomyPolicy {
  if (!value) return defaultOutreachAutonomyPolicy
  return outreachAutonomyPolicySchema.parse(value)
}

export function isIrreversibleOutreachAction(action: OutreachAutonomousAction): boolean {
  return irreversibleOutreachActions.has(action)
}
