export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const venueRuleInputSchema = z.object({
  title: z.string().trim().min(1, 'Rule title is required').max(160, 'Rule title is too long'),
  description: z.string().trim().min(1, 'Rule description is required').max(1500, 'Rule description is too long'),
  rule_type: z.enum(['general', 'insurance', 'safety', 'conduct']),
  applies_to: z.enum(['all', 'vendors', 'organizations', 'builders']),
  is_mandatory: z.boolean(),
})

const saveRulesSchema = z.object({
  venueId: z.string().uuid('Invalid venue id'),
  rules: z.array(venueRuleInputSchema).max(50, 'A venue can have up to 50 rules'),
})

type VenueRuleRow = z.infer<typeof venueRuleInputSchema> & {
  id: string
  venue_id: string
  display_order: number
}

/**
 * Groups rules by type for display in booking and venue profile surfaces.
 *
 * @param rules - Flat venue rule rows from Supabase.
 * @returns Rules keyed by general, insurance, safety, and conduct.
 */
function groupRulesByType(rules: VenueRuleRow[]) {
  return {
    general: rules.filter((rule) => rule.rule_type === 'general'),
    insurance: rules.filter((rule) => rule.rule_type === 'insurance'),
    safety: rules.filter((rule) => rule.rule_type === 'safety'),
    conduct: rules.filter((rule) => rule.rule_type === 'conduct'),
  }
}

/**
 * Verifies that the current authenticated user owns a venue.
 *
 * @param venueId - Venue id to check.
 * @returns True when the current user is the venue owner.
 */
async function currentUserOwnsVenue(venueId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ownsVenue: false, status: 401, error: 'Unauthorized' }
  }

  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .select('id, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) {
    console.error('[venue.rules] Venue lookup failed', venueError)
    return { ownsVenue: false, status: 500, error: 'Failed to verify venue ownership' }
  }

  if (!venue) {
    return { ownsVenue: false, status: 404, error: 'Venue not found' }
  }

  if ((venue as { owner_id?: string }).owner_id !== user.id) {
    return { ownsVenue: false, status: 403, error: 'Not authorized' }
  }

  return { ownsVenue: true, status: 200, error: null }
}

/**
 * Returns all house rules for a venue.
 *
 * @route GET /api/venue/rules?venueId={id}
 * @auth Required - any signed-in user can view rules.
 *
 * @param request - Request containing `venueId` query parameter.
 * @returns Flat and grouped venue rules.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const venueId = request.nextUrl.searchParams.get('venueId')

    if (!venueId) {
      return NextResponse.json({ error: 'venueId required' }, { status: 400 })
    }

    const { data: rules, error } = await supabase
      .from('venue_rules')
      .select('*')
      .eq('venue_id', venueId)
      .order('display_order', { ascending: true })

    if (error) {
      console.error('[venue.rules] Failed to load rules', error)
      return NextResponse.json({ error: 'Failed to load venue rules' }, { status: 500 })
    }

    const rows = (rules as VenueRuleRow[] | null) ?? []
    return NextResponse.json({
      rules: rows,
      grouped: groupRulesByType(rows),
    })
  } catch (error) {
    console.error('[venue.rules] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load venue rules' }, { status: 500 })
  }
}

/**
 * Replaces all rules for a venue in a single owner-only save operation.
 *
 * @route POST /api/venue/rules
 * @auth Required - venue owner only.
 *
 * @param request - JSON body containing venueId and rules array.
 * @returns Newly saved rule rows.
 */
export async function POST(request: NextRequest) {
  try {
    const body = saveRulesSchema.safeParse(await request.json())

    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid rules payload', details: body.error.flatten() },
        { status: 400 }
      )
    }

    const { venueId, rules } = body.data
    const ownership = await currentUserOwnsVenue(venueId)

    if (!ownership.ownsVenue) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const supabase = createClient()
    const { error: deleteError } = await supabase
      .from('venue_rules')
      .delete()
      .eq('venue_id', venueId)

    if (deleteError) {
      console.error('[venue.rules] Failed to delete existing rules', deleteError)
      return NextResponse.json({ error: 'Failed to replace venue rules' }, { status: 500 })
    }

    const rulesWithOrder = rules.map((rule, index) => ({
      venue_id: venueId,
      ...rule,
      display_order: index,
    }))

    if (rulesWithOrder.length === 0) {
      return NextResponse.json({ rules: [] })
    }

    const { data: newRules, error } = await supabase
      .from('venue_rules')
      .insert(rulesWithOrder as never)
      .select('*')
      .order('display_order', { ascending: true })

    if (error) {
      console.error('[venue.rules] Failed to insert rules', error)
      return NextResponse.json({ error: 'Failed to save venue rules' }, { status: 500 })
    }

    return NextResponse.json({ rules: newRules ?? [] })
  } catch (error) {
    console.error('[venue.rules] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save venue rules' }, { status: 500 })
  }
}
