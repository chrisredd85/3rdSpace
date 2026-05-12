export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgent } from '@/lib/ai/agents'
import type { DataConnectionAgentOutput } from '@/lib/ai/agents/dataConnectionAgent'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import type { TicketPlatform } from '@/lib/constants/account-setup'

const ticketPlatformSchema = z.enum(['eventbrite', 'luma', 'posh', 'partiful'])

const setupRequestSchema = z.object({
  plan_id: z.string().uuid().nullable().optional(),
  platform: ticketPlatformSchema.nullable().optional(),
  external_event_url: z.string().trim().min(1).max(2000).nullable().optional(),
  data_goal: z.string().trim().min(1).max(500).optional(),
})

type SetupConnection = {
  platform: TicketPlatform
  status: string
  account_label: string | null
  webhook_url: string | null
  last_connected_at: string | null
  has_event_link: boolean
}

/**
 * Builds an AI-assisted setup guide for event data connections.
 *
 * This endpoint intentionally only guides setup. The check-in, sales, refund,
 * and attendance metrics are computed by deterministic report routes after data
 * lands in imported_attendees and event_sales_data.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const parsed = setupRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
    }

    const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
    if (builderError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    const [plan, connections] = await Promise.all([
      parsed.data.plan_id ? loadOwnedPlan(supabase, parsed.data.plan_id, user.id) : Promise.resolve(null),
      loadTicketingConnections(supabase, builderProfileId),
    ])

    if (parsed.data.plan_id && !plan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const payload = {
      current_plan: plan,
      requested_platform: parsed.data.platform ?? null,
      external_event_url: parsed.data.external_event_url ?? null,
      connected_platforms: connections,
      data_goal: parsed.data.data_goal ?? 'Track RSVPs, ticket sales, refunds, and check-ins for this event.',
    }

    let setup: DataConnectionAgentOutput
    let agentMode: 'openai' | 'deterministic' = 'deterministic'

    if (process.env.OPENAI_API_KEY) {
      try {
        const result = await runAgent({
          agent_name: 'data_connection',
          event_id: null,
          user_id: user.id,
          payload,
        })
        if (result.status === 'succeeded') {
          setup = result.output as DataConnectionAgentOutput
          agentMode = 'openai'
        } else {
          setup = buildDeterministicSetup(payload)
        }
      } catch (error) {
        console.warn('[planner.data-connections.setup] Falling back to deterministic setup guide', error)
        setup = buildDeterministicSetup(payload)
      }
    } else {
      setup = buildDeterministicSetup(payload)
    }

    return NextResponse.json({
      setup,
      agent_mode: agentMode,
      connections,
    })
  } catch (error) {
    console.error('[planner.data-connections.setup] Failed to build setup guide', error)
    return NextResponse.json({ error: 'Unable to build data connection setup guide' }, { status: 500 })
  }
}

async function loadOwnedPlan(
  supabase: ReturnType<typeof createClient>,
  planId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('plans')
    .select('id, title, event_type, status, guest_count, neighborhood, date_window_start, date_window_end, ticketed, ticketing_model, metadata')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[planner.data-connections.setup] Plan lookup failed', error)
    return null
  }

  return data ?? null
}

async function loadTicketingConnections(
  supabase: ReturnType<typeof createClient>,
  builderProfileId: string
): Promise<SetupConnection[]> {
  const { data, error } = await supabase
    .from('builder_ticketing_connections')
    .select('platform, status, account_label, webhook_url, last_connected_at, config')
    .eq('builder_id', builderProfileId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[planner.data-connections.setup] Connection lookup failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row): SetupConnection | null => {
      const platform = readTicketPlatform(row.platform)
      if (!platform) return null
      const config = readRecord(row.config)
      return {
        platform,
        status: readString(row.status) ?? 'setup_required',
        account_label: readString(row.account_label),
        webhook_url: readString(row.webhook_url),
        last_connected_at: readString(row.last_connected_at),
        has_event_link: Boolean(config?.event_url || row.webhook_url),
      }
    })
    .filter((row): row is SetupConnection => row !== null)
}

function buildDeterministicSetup(input: {
  current_plan: Record<string, unknown> | null
  requested_platform: TicketPlatform | null
  external_event_url: string | null
  connected_platforms: SetupConnection[]
  data_goal: string
}): DataConnectionAgentOutput {
  const ticketed = readBoolean(input.current_plan?.ticketed)
  const existing = input.requested_platform
    ? input.connected_platforms.find((connection) => connection.platform === input.requested_platform) ?? null
    : input.connected_platforms.find(isUsableConnection) ?? input.connected_platforms[0] ?? null
  const recommendedPlatform = input.requested_platform ?? existing?.platform ?? (ticketed ? 'eventbrite' : 'luma')
  const existingForRecommended = input.connected_platforms.find((connection) => connection.platform === recommendedPlatform) ?? null
  const hasConnection = Boolean(existingForRecommended && isUsableConnection(existingForRecommended))
  const hasEventLink = Boolean(input.external_event_url || existingForRecommended?.has_event_link)

  const setupStatus: DataConnectionAgentOutput['setup_status'] =
    !recommendedPlatform
      ? 'needs_platform_choice'
      : !hasConnection
        ? 'needs_connection'
        : !hasEventLink
          ? 'needs_event_link'
          : 'ready_to_collect'

  const platformLabel = formatPlatform(recommendedPlatform)
  const setupSteps: DataConnectionAgentOutput['setup_steps'] = []

  if (!hasConnection) {
    setupSteps.push({
      title: `Connect ${platformLabel}`,
      detail:
        recommendedPlatform === 'eventbrite'
          ? 'Start Eventbrite OAuth so 3rdPlace can import tickets, attendees, refunds, and check-ins for events you link.'
          : `Create the ${platformLabel} webhook connection and copy the generated webhook URL into ${platformLabel}.`,
      action_type: recommendedPlatform === 'eventbrite' ? 'oauth' : 'webhook',
    })
  }

  setupSteps.push({
    title: 'Link this event',
    detail: hasEventLink
      ? 'The event link is present. Verify it points to the exact RSVP or ticket page for this plan.'
      : 'Paste or select the external event URL so imported rows attach to this plan instead of only the account.',
    action_type: recommendedPlatform === 'partiful' ? 'event_link' : 'verify',
  })

  setupSteps.push({
    title: 'Verify imported signals',
    detail: 'Confirm that RSVPs or tickets appear before the event, then check-ins appear after doors open.',
    action_type: 'verify',
  })

  setupSteps.push({
    title: 'Collect venue-only traffic facts',
    detail: 'After the event, ask the venue for walk-ins, peak room count, bar/cafe sales, and any unusual foot-traffic notes.',
    action_type: 'manual_question',
  })

  return {
    summary:
      setupStatus === 'ready_to_collect'
        ? `${platformLabel} is ready for deterministic RSVP, ticket, refund, and check-in rollups.`
        : `Set up ${platformLabel} so 3rdPlace can calculate actual attendance and venue traffic signals from pulled data.`,
    recommended_platform: recommendedPlatform,
    setup_status: setupStatus,
    setup_steps: setupSteps,
    data_sources: [
      {
        source: platformLabel,
        metrics: ['RSVPs or tickets', 'refunds', 'check-ins', 'arrival timing'],
        collection_method: recommendedPlatform === 'eventbrite' ? 'api' : recommendedPlatform === 'partiful' ? 'event_link' : 'webhook',
      },
      {
        source: 'Venue post-event report',
        metrics: ['walk-ins', 'peak room count', 'bar or cafe sales', 'staff-observed foot traffic'],
        collection_method: 'manual',
      },
    ],
    post_event_questions: [
      'How many guests checked in through the platform or door list?',
      'How many walk-ins did the venue observe?',
      'What was the peak room count and when did it happen?',
      'What were bar, cafe, or food sales during the event window?',
      'Did the venue feel empty, right-sized, or overcrowded?',
    ],
    cost_note: 'AI is used for setup guidance only; raw event metrics are aggregated deterministically from ticketing and check-in tables.',
    guardrails: [
      'Do not invent foot traffic or revenue numbers.',
      'Use webhook/API rows for metrics before asking the organizer for manual estimates.',
      'Treat venue-reported bar sales and walk-ins as separate from ticketing platform attendance.',
    ],
  }
}

function isUsableConnection(connection: SetupConnection) {
  return ['connected', 'linked', 'completed', 'setup_required'].includes(connection.status)
}

function readTicketPlatform(value: unknown): TicketPlatform | null {
  return value === 'eventbrite' || value === 'luma' || value === 'posh' || value === 'partiful' ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function formatPlatform(platform: TicketPlatform) {
  if (platform === 'eventbrite') return 'Eventbrite'
  if (platform === 'luma') return 'Luma'
  if (platform === 'posh') return 'Posh'
  return 'Partiful'
}
