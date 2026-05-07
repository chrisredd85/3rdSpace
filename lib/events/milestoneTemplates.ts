import { z } from 'zod'
import { eventPlanSchema } from '@/lib/ai/types'

const DAY_MS = 24 * 60 * 60 * 1000

const nullableStringSchema = z.string().trim().min(1).nullable()
const nullableNumberSchema = z.number().nullable()

export const timelineVenueBookingRowSchema = z.object({
  id: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
  venue_id: z.string().trim().min(1),
  status: nullableStringSchema,
  quoted_price: nullableNumberSchema,
  booking_date: z.string().trim().min(1).optional(),
  start_time: z.string().trim().min(1).nullable().optional(),
  end_time: z.string().trim().min(1).nullable().optional(),
}).passthrough()

export const timelineVendorBookingRowSchema = z.object({
  id: z.string().trim().min(1),
  event_id: z.string().trim().min(1),
  vendor_id: z.string().trim().min(1),
  status: nullableStringSchema,
  quoted_price: nullableNumberSchema,
  booking_date: z.string().trim().min(1).optional(),
  start_time: z.string().trim().min(1).nullable().optional(),
  end_time: z.string().trim().min(1).nullable().optional(),
  confirmed_start_time: z.string().trim().min(1).nullable().optional(),
  confirmed_end_time: z.string().trim().min(1).nullable().optional(),
  setup_time: z.string().trim().min(1).nullable().optional(),
}).passthrough()

export const timelineVenueRequirementSchema = z.object({
  id: z.string().trim().min(1),
  venue_id: z.string().trim().min(1),
  requirement_type: nullableStringSchema,
  is_required: z.boolean().nullable(),
  description: nullableStringSchema,
  minimum_liability_coverage: nullableNumberSchema,
  requires_additional_insured: z.boolean().nullable(),
  custom_question: nullableStringSchema,
}).passthrough()

export const planningMilestoneSchema = z.object({
  title: z.string().trim().min(1),
  due_date: z.string().trim().min(1),
  category: z.string().trim().min(1),
  is_blocking: z.boolean(),
})

export const dayOfTimelineItemSchema = z.object({
  time: z.string().trim().min(1),
  activity: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  notes: z.string().trim().min(1).nullable(),
})

export const milestoneTemplateInputSchema = z.object({
  event_plan: eventPlanSchema,
  event_date: z.string().trim().min(1),
  confirmed_venue_bookings: z.array(timelineVenueBookingRowSchema),
  confirmed_vendor_bookings: z.array(timelineVendorBookingRowSchema),
  venue_requirements: z.array(timelineVenueRequirementSchema).default([]),
})

export const milestoneTemplateOutputSchema = z.object({
  planning_milestones: z.array(planningMilestoneSchema),
  day_of_timeline: z.array(dayOfTimelineItemSchema),
  staffing_needs: z.array(z.string().trim().min(1)),
  reminders: z.array(z.string().trim().min(1)),
  dependency_warnings: z.array(z.string().trim().min(1)),
  impossible_timeline: z.boolean(),
})

export type TimelineVenueBookingRow = z.infer<typeof timelineVenueBookingRowSchema>
export type TimelineVendorBookingRow = z.infer<typeof timelineVendorBookingRowSchema>
export type TimelineVenueRequirement = z.infer<typeof timelineVenueRequirementSchema>
export type PlanningMilestone = z.infer<typeof planningMilestoneSchema>
export type DayOfTimelineItem = z.infer<typeof dayOfTimelineItemSchema>
export type MilestoneTemplateInput = z.input<typeof milestoneTemplateInputSchema>
export type MilestoneTemplateOutput = z.infer<typeof milestoneTemplateOutputSchema>

export function generateMilestoneTemplate(
  input: MilestoneTemplateInput,
  currentDate: Date = new Date()
): MilestoneTemplateOutput {
  const parsed = milestoneTemplateInputSchema.parse(input)
  const eventDate = parseIsoDate(parsed.event_date)
  const daysUntilEvent = Math.ceil((eventDate.getTime() - startOfUtcDay(currentDate).getTime()) / DAY_MS)
  const hasVenueBooking = parsed.confirmed_venue_bookings.length > 0
  const hasVendorBookings = parsed.confirmed_vendor_bookings.length > 0
  const impossibleTimeline = daysUntilEvent < 7

  const planningMilestones = [
    milestone('Confirm venue booking', eventDate, 30, 'booking', true),
    milestone('Pay venue deposit', eventDate, 28, 'payment', true),
    milestone('Confirm vendor bookings', eventDate, 21, 'booking', true),
    milestone('Launch tickets or RSVP page', eventDate, 21, 'ticketing', true),
    milestone('Send first promo push', eventDate, 18, 'marketing', false),
    milestone('Confirm final headcount', eventDate, 5, 'operations', true),
    milestone('Run day-before check', eventDate, 1, 'logistics', true),
    milestone('Setup window', eventDate, 0, 'day-of', true),
    milestone('Doors open', eventDate, 0, 'day-of', true),
    milestone('Programming starts', eventDate, 0, 'day-of', false),
    milestone('Teardown and venue closeout', eventDate, 0, 'day-of', true),
    ...buildVenueRequirementMilestones(parsed.venue_requirements, eventDate),
  ].sort(compareMilestones)

  const dependencyWarnings = buildDependencyWarnings({
    daysUntilEvent,
    impossibleTimeline,
    hasVenueBooking,
    hasVendorBookings,
    venueRequirements: parsed.venue_requirements,
  })

  return milestoneTemplateOutputSchema.parse({
    planning_milestones: planningMilestones,
    day_of_timeline: buildDayOfTimeline(parsed),
    staffing_needs: buildStaffingNeeds(parsed),
    reminders: buildReminders(parsed, impossibleTimeline),
    dependency_warnings: dependencyWarnings,
    impossible_timeline: impossibleTimeline,
  })
}

function milestone(
  title: string,
  eventDate: Date,
  daysBeforeEvent: number,
  category: string,
  isBlocking: boolean
): PlanningMilestone {
  return {
    title,
    due_date: toIsoDate(addDays(eventDate, -daysBeforeEvent)),
    category,
    is_blocking: isBlocking,
  }
}

function buildVenueRequirementMilestones(
  venueRequirements: TimelineVenueRequirement[],
  eventDate: Date
): PlanningMilestone[] {
  return venueRequirements
    .filter((requirement) => requirement.is_required !== false)
    .map((requirement) => {
      const label = formatRequirementLabel(requirement)
      return milestone(`Complete venue requirement: ${label}`, eventDate, 14, 'compliance', true)
    })
}

function buildDayOfTimeline(input: z.infer<typeof milestoneTemplateInputSchema>): DayOfTimelineItem[] {
  const venueBooking = input.confirmed_venue_bookings[0]
  const firstVendorSetup = input.confirmed_vendor_bookings.find((booking) => booking.setup_time)?.setup_time

  return [
    {
      time: firstVendorSetup ?? '15:00',
      activity: 'Vendor load-in and setup',
      owner: 'Event lead',
      notes: input.confirmed_vendor_bookings.length > 0
        ? 'Confirm vendor arrival windows and access instructions.'
        : 'Vendor schedule is not confirmed yet.',
    },
    {
      time: venueBooking?.start_time ?? '16:00',
      activity: 'Venue setup window',
      owner: 'Event lead',
      notes: 'Run layout, signage, check-in, food/drink, and AV checks.',
    },
    {
      time: '18:00',
      activity: 'Doors open',
      owner: 'Check-in lead',
      notes: 'Start guest check-in and monitor capacity.',
    },
    {
      time: '19:00',
      activity: 'Programming starts',
      owner: 'Host',
      notes: 'Begin planned remarks, dinner, panel, or main experience.',
    },
    {
      time: venueBooking?.end_time ?? '22:00',
      activity: 'Teardown and venue closeout',
      owner: 'Event lead',
      notes: 'Confirm cleanup, load-out, incident notes, and final venue signoff.',
    },
  ]
}

function buildStaffingNeeds(input: z.infer<typeof milestoneTemplateInputSchema>): string[] {
  const needs = ['Event lead', 'Check-in lead', 'Setup/load-in support']
  const headcount = input.event_plan.expected_attendance ?? input.event_plan.headcount_max

  if (headcount !== null && headcount >= 75) {
    needs.push('Additional front-door support for higher guest volume')
  }

  if (input.confirmed_vendor_bookings.length > 0) {
    needs.push('Vendor point of contact')
  }

  return needs
}

function buildReminders(
  input: z.infer<typeof milestoneTemplateInputSchema>,
  impossibleTimeline: boolean
): string[] {
  const reminders = [
    'Confirm all arrival, setup, and teardown windows in writing.',
    'Reconfirm final headcount before the venue cutoff.',
    'Keep approvals human-reviewed before bookings, payments, or commitments.',
  ]

  if (input.confirmed_venue_bookings.length === 0) {
    reminders.push('Venue is not confirmed yet; prioritize venue outreach and terms.')
  }

  if (input.confirmed_vendor_bookings.length === 0) {
    reminders.push('No vendors are confirmed yet; prioritize critical vendor booking.')
  }

  if (impossibleTimeline) {
    reminders.push('Escalate to concierge/admin support because the event is inside the 7-day planning window.')
  }

  return reminders
}

function buildDependencyWarnings(input: {
  daysUntilEvent: number
  impossibleTimeline: boolean
  hasVenueBooking: boolean
  hasVendorBookings: boolean
  venueRequirements: TimelineVenueRequirement[]
}): string[] {
  const warnings: string[] = []

  if (input.impossibleTimeline) {
    warnings.push(
      `Event date is ${Math.max(input.daysUntilEvent, 0)} days away, so critical milestones may not be completable before the event.`
    )
  }

  if (!input.hasVenueBooking) {
    warnings.push('Venue confirmation is missing and blocks deposit, setup, and day-of logistics.')
  }

  if (!input.hasVendorBookings) {
    warnings.push('Vendor bookings are missing and may block food, AV, entertainment, or staffing plans.')
  }

  input.venueRequirements
    .filter((requirement) => requirement.is_required !== false)
    .forEach((requirement) => {
      warnings.push(`Venue requirement needs completion: ${formatRequirementLabel(requirement)}.`)
    })

  return warnings
}

function formatRequirementLabel(requirement: TimelineVenueRequirement): string {
  if (requirement.custom_question) return requirement.custom_question
  if (requirement.description) return requirement.description
  if (requirement.requirement_type) return requirement.requirement_type.replace(/_/g, ' ')
  return `requirement ${requirement.id}`
}

function parseIsoDate(date: string): Date {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) {
    throw new Error('event_date must be an ISO date string')
  }

  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('event_date must be a valid ISO date string')
  }

  return parsed
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function compareMilestones(first: PlanningMilestone, second: PlanningMilestone): number {
  if (first.due_date !== second.due_date) return first.due_date.localeCompare(second.due_date)
  return first.title.localeCompare(second.title)
}
