export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  buildEventbriteAuthorizeUrl,
  EVENTBRITE_DEFAULT_SCOPES,
  requiredEventbriteEnv,
} from '@/lib/integrations/eventbrite/client'
import { EVENTBRITE_PLATFORM, loadEventbriteConnection } from '@/lib/integrations/eventbrite/sync'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type PlannerDb = { from: (table: string) => any }

type BuilderAuth =
  | { db: PlannerDb; userId: string; builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const clientId = requiredEventbriteEnv('EVENTBRITE_CLIENT_ID')
    const redirectUri = getEventbriteRedirectUri(request)
    const state = randomBytes(32).toString('hex')
    const existing = await loadEventbriteConnection(auth.db, auth.builderProfileId)
    const existingConfig = existing?.config ?? {}

    const { error } = await auth.db
      .from('builder_ticketing_connections')
      .upsert(
        {
          builder_id: auth.builderProfileId,
          platform: EVENTBRITE_PLATFORM,
          status: existing?.access_token_encrypted ? existing.status : 'pending',
          account_label: 'Eventbrite',
          webhook_url: existing?.webhook_url ?? null,
          webhook_secret_encrypted: existing?.webhook_secret_encrypted ?? null,
          config: {
            ...existingConfig,
            oauth_state: state,
            oauth_redirect_uri: redirectUri,
            oauth_scope: EVENTBRITE_DEFAULT_SCOPES,
            initiated_by: auth.userId,
            initiated_at: new Date().toISOString(),
          },
          last_error: null,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'builder_id,platform' }
      )

    if (error) throw new Error(error.message ?? 'Failed to start Eventbrite OAuth')

    return NextResponse.json({
      authUrl: buildEventbriteAuthorizeUrl({
        clientId,
        redirectUri,
        state,
        scope: EVENTBRITE_DEFAULT_SCOPES,
      }),
    })
  } catch (error) {
    console.error('[eventbrite.connect] Failed to start OAuth', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Eventbrite OAuth' },
      { status: 500 }
    )
  }
}

async function getAuthenticatedBuilder(): Promise<BuilderAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  const { builderProfileId, error: builderError } = await getBuilderProfileId(supabase, user.id)
  if (builderError || !builderProfileId) {
    return { response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }) }
  }

  return {
    db: supabase as unknown as PlannerDb,
    userId: user.id,
    builderProfileId,
  }
}

function getEventbriteRedirectUri(request: NextRequest) {
  return (
    process.env.EVENTBRITE_OAUTH_REDIRECT_URI ??
    new URL('/api/integrations/eventbrite/callback', request.nextUrl.origin).toString()
  )
}
