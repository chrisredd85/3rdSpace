export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { runEventScreenshotAgent } from '@/lib/ai/agents/eventScreenshotAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type SupabaseAdminClient = any

type BuilderAuth =
  | { builderProfileId: string }
  | { response: NextResponse<{ error: string }> }

type ImportSession = {
  id: string
  builder_id: string
  source: 'posh' | 'eventbrite' | 'luma' | 'partiful' | 'other'
  payload: Record<string, any>
}

export async function POST(
  request: NextRequest,
  { params }: { params: { importId: string } }
) {
  try {
    const auth = await getAuthenticatedBuilder()
    if ('response' in auth) return auth.response

    const admin = createServiceRoleClient() as SupabaseAdminClient
    const session = await loadSession(admin, params.importId, auth.builderProfileId)
    if (!session) return NextResponse.json({ error: 'Import session not found' }, { status: 404 })

    const formData = await request.formData()
    const files = formData
      .getAll('screenshots')
      .filter((file): file is File => file instanceof File)
      .slice(0, 5)

    if (files.length === 0) {
      return NextResponse.json({ error: 'Upload at least one screenshot' }, { status: 400 })
    }

    const agentFiles = await Promise.all(files.map(async (file) => ({
      filename: file.name,
      mimeType: file.type || 'image/png',
      base64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    })))
    const result = await runEventScreenshotAgent({
      files: agentFiles,
      platform: session.source,
    })
    const payload = {
      ...(session.payload ?? {}),
      screenshot_extraction: {
        ...result.output,
        agent: {
          name: result.agent_name,
          model: result.model,
          duration_ms: result.duration_ms,
        },
        files: files.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
        })),
      },
    }

    await updateSession(admin, session.id, payload)

    return NextResponse.json({
      importId: session.id,
      extraction: result.output,
      agentMode: result.model,
    })
  } catch (error) {
    console.error('[planner.events.import.screenshot] Screenshot import failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Screenshot extraction failed' },
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

  return { builderProfileId }
}

async function loadSession(db: SupabaseAdminClient, importId: string, builderId: string) {
  const { data, error } = await db
    .from('event_import_sessions')
    .select('id, builder_id, source, payload')
    .eq('id', importId)
    .eq('builder_id', builderId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load import session')
  return data as ImportSession | null
}

async function updateSession(
  db: SupabaseAdminClient,
  importId: string,
  payload: Record<string, unknown>
) {
  const { error } = await db
    .from('event_import_sessions')
    .update({
      payload,
      status: 'ready',
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', importId)

  if (error) throw new Error(error.message ?? 'Failed to update import session')
}
