import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { encryptSecret } from '@/lib/server/token-crypto'
import type { TicketPlatform } from '@/lib/constants/account-setup'

type ConnectionBody = {
  platform?: TicketPlatform
  externalAccountId?: string
  accountLabel?: string
  webhookSecret?: string
}

const ticketPlatforms = new Set<TicketPlatform>(['eventbrite', 'luma', 'posh'])

function buildAccountWebhookUrl(origin: string, platform: TicketPlatform, connectionId: string) {
  const url = new URL(`/api/webhooks/${platform}`, origin)
  url.searchParams.set('builderConnectionId', connectionId)
  return url.toString()
}

async function getAuthenticatedBuilder() {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { supabase, user: null, builderProfileId: null, error: 'Unauthorized', status: 401 }
  }

  const { builderProfileId, error } = await getBuilderProfileId(supabase, user.id)
  if (error || !builderProfileId) {
    return { supabase, user, builderProfileId: null, error: 'Builder profile not found', status: 403 }
  }

  return { supabase, user, builderProfileId, error: null, status: 200 }
}

/**
 * Lists account-level ticketing connections for the authenticated builder.
 */
export async function GET() {
  const { supabase, builderProfileId, error, status } = await getAuthenticatedBuilder()
  if (!builderProfileId) {
    return NextResponse.json({ error }, { status })
  }

  const { data, error: queryError } = await supabase
    .from('builder_ticketing_connections')
    .select('id, platform, status, external_account_id, account_label, webhook_url, last_connected_at, last_error, config')
    .eq('builder_id', builderProfileId)
    .order('created_at', { ascending: true })

  if (queryError) {
    console.error('[ticketing.connections] Failed to load connections', queryError)
    return NextResponse.json({ error: 'Failed to load ticketing connections' }, { status: 500 })
  }

  return NextResponse.json({ connections: data ?? [] })
}

/**
 * Creates or updates an account-level ticketing connection placeholder.
 */
export async function POST(request: NextRequest) {
  const { supabase, builderProfileId, error, status } = await getAuthenticatedBuilder()
  if (!builderProfileId) {
    return NextResponse.json({ error }, { status })
  }

  const body = (await request.json()) as ConnectionBody
  if (!body.platform || !ticketPlatforms.has(body.platform)) {
    return NextResponse.json({ error: 'Unsupported ticketing platform' }, { status: 400 })
  }

  const { data: existingConnection } = await supabase
    .from('builder_ticketing_connections')
    .select('id, config')
    .eq('builder_id', builderProfileId)
    .eq('platform', body.platform)
    .maybeSingle()

  const encryptedWebhookSecret =
    typeof body.webhookSecret === 'string' && body.webhookSecret.trim()
      ? encryptSecret(body.webhookSecret.trim())
      : undefined

  const config = {
    ...(((existingConnection as { config?: Record<string, unknown> | null } | null)?.config) ?? {}),
    selected_from_setup_center: true,
    ...(encryptedWebhookSecret && { has_webhook_secret: true }),
  }

  const { data, error: upsertError } = await supabase
    .from('builder_ticketing_connections')
    .upsert(
      {
        builder_id: builderProfileId,
        platform: body.platform,
        status: body.platform === 'eventbrite' ? 'setup_required' : 'setup_required',
        external_account_id: body.externalAccountId?.trim() || null,
        account_label: body.accountLabel?.trim() || null,
        ...(encryptedWebhookSecret && { webhook_secret_encrypted: encryptedWebhookSecret }),
        config,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'builder_id,platform' }
    )
    .select('id, platform, status, external_account_id, account_label, webhook_url, last_connected_at, last_error, config')
    .single()

  if (upsertError) {
    console.error('[ticketing.connections] Failed to save connection', upsertError)
    return NextResponse.json({ error: 'Failed to save ticketing connection' }, { status: 500 })
  }

  let connection = data as { id: string; platform: TicketPlatform; webhook_url?: string | null }
  let webhookUrl = connection.webhook_url ?? null

  if (body.platform !== 'eventbrite') {
    webhookUrl = buildAccountWebhookUrl(request.nextUrl.origin, body.platform, connection.id)
    const { data: updatedConnection, error: updateError } = await supabase
      .from('builder_ticketing_connections')
      .update({
        webhook_url: webhookUrl,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', connection.id)
      .select('id, platform, status, external_account_id, account_label, webhook_url, last_connected_at, last_error, config')
      .single()

    if (updateError) {
      console.error('[ticketing.connections] Failed to save webhook URL', updateError)
      return NextResponse.json({ error: 'Failed to save webhook URL' }, { status: 500 })
    }

    connection = updatedConnection as typeof connection
  }

  return NextResponse.json({
    success: true,
    connection,
    webhookUrl,
  })
}
