export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { encryptSecret } from '@/lib/server/token-crypto'

type SetupWebhookBody = {
  eventId?: string
  platform?: 'posh' | 'luma'
  externalEventId?: string
  webhookSecret?: string
}

function buildWebhookUrl(origin: string, platform: 'posh' | 'luma', integrationId: string) {
  const url = new URL(`/api/webhooks/${platform}`, origin)
  url.searchParams.set('integrationId', integrationId)
  return url.toString()
}

function buildAccountWebhookUrl(origin: string, platform: 'posh' | 'luma', connectionId: string) {
  const url = new URL(`/api/webhooks/${platform}`, origin)
  url.searchParams.set('builderConnectionId', connectionId)
  return url.toString()
}

/**
 * Creates or updates a webhook-based Posh/Luma integration for an event.
 *
 * @route POST /api/integrations/webhooks/setup
 * @auth Required - Event creator only
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SetupWebhookBody

    if (!body.platform) {
      return NextResponse.json({ error: 'Missing platform' }, { status: 400 })
    }

    if (!['posh', 'luma'].includes(body.platform)) {
      return NextResponse.json({ error: 'Unsupported webhook platform' }, { status: 400 })
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)

    if (builderError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    if (!body.eventId) {
      const encryptedWebhookSecret =
        typeof body.webhookSecret === 'string' && body.webhookSecret.trim()
          ? encryptSecret(body.webhookSecret.trim())
          : undefined

      const { data: connection, error: connectionError } = await supabase
        .from('builder_ticketing_connections')
        .upsert(
          {
            builder_id: builderProfileId,
            platform: body.platform,
            status: 'setup_required',
            external_account_id: body.externalEventId || null,
            ...(encryptedWebhookSecret && { webhook_secret_encrypted: encryptedWebhookSecret }),
            config: {
              account_level_webhook: true,
              has_webhook_secret: Boolean(encryptedWebhookSecret),
              configured_by: user.id,
              configured_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: 'builder_id,platform' }
        )
        .select('id')
        .single()

      if (connectionError) {
        console.error('[webhooks.setup] Failed to create account-level connection', connectionError)
        return NextResponse.json({ error: 'Failed to configure webhook connection' }, { status: 500 })
      }

      const webhookUrl = buildAccountWebhookUrl(request.nextUrl.origin, body.platform, (connection as { id: string }).id)

      const { error: updateConnectionError } = await supabase
        .from('builder_ticketing_connections')
        .update({
          webhook_url: webhookUrl,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', (connection as { id: string }).id)

      if (updateConnectionError) {
        console.error('[webhooks.setup] Failed to save account-level webhook URL', updateConnectionError)
        return NextResponse.json({ error: 'Failed to save webhook URL' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        connectionId: (connection as { id: string }).id,
        webhookUrl,
      })
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id')
      .eq('id', body.eventId)
      .eq('builder_id', builderProfileId)
      .maybeSingle()

    if (eventError) {
      console.error('[webhooks.setup] Event lookup failed', eventError)
      return NextResponse.json({ error: 'Failed to verify event ownership' }, { status: 500 })
    }

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    }

    const { data: existingIntegration, error: existingError } = await supabase
      .from('external_event_integrations')
      .select('id, external_event_id, config')
      .eq('event_id', body.eventId)
      .eq('platform', body.platform)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingError) {
      console.error('[webhooks.setup] Existing integration lookup failed', existingError)
      return NextResponse.json({ error: 'Failed to configure webhook integration' }, { status: 500 })
    }

    const config = {
      ...(((existingIntegration as { config?: Record<string, any> | null } | null)?.config) ?? {}),
      webhook_secret:
        typeof body.webhookSecret === 'string' && body.webhookSecret.trim()
          ? body.webhookSecret.trim()
          : ((existingIntegration as { config?: Record<string, any> | null } | null)?.config?.webhook_secret ?? null),
      configured_by: user.id,
      configured_at: new Date().toISOString(),
    }

    let integrationId = (existingIntegration as { id?: string } | null)?.id ?? null

    if (integrationId) {
      const { error: updateError } = await supabase
        .from('external_event_integrations')
        .update({
          external_event_id:
            typeof body.externalEventId === 'string'
              ? body.externalEventId || null
              : ((existingIntegration as { external_event_id?: string | null } | null)?.external_event_id ?? null),
          sync_status: 'connected',
          sync_error: null,
          config,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', integrationId)

      if (updateError) {
        console.error('[webhooks.setup] Failed to update integration', updateError)
        return NextResponse.json({ error: 'Failed to configure webhook integration' }, { status: 500 })
      }
    } else {
      const { data: insertedIntegration, error: insertError } = await supabase
        .from('external_event_integrations')
        .insert({
          event_id: body.eventId,
          platform: body.platform,
          external_event_id: body.externalEventId || null,
          sync_status: 'connected',
          config,
        } as never)
        .select('id')
        .single()

      if (insertError) {
        console.error('[webhooks.setup] Failed to create integration', insertError)
        return NextResponse.json({ error: 'Failed to configure webhook integration' }, { status: 500 })
      }

      integrationId = (insertedIntegration as { id: string }).id
    }

    const webhookUrl = buildWebhookUrl(request.nextUrl.origin, body.platform, integrationId)

    const { error: webhookUrlError } = await supabase
      .from('external_event_integrations')
      .update({
        webhook_url: webhookUrl,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', integrationId)

    if (webhookUrlError) {
      console.error('[webhooks.setup] Failed to save webhook URL', webhookUrlError)
    }

    return NextResponse.json({
      success: true,
      integrationId,
      webhookUrl,
    })
  } catch (error) {
    console.error('[webhooks.setup] Unexpected error', error)
    return NextResponse.json({ error: 'Failed to configure webhook integration' }, { status: 500 })
  }
}
