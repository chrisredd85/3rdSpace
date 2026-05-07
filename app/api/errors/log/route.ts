export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

type ErrorLogDb = { from: (table: string) => any }

const errorLogSchema = z.object({
  source: z.string().trim().min(1).max(80).default('client'),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).nullable().optional(),
  path: z.string().max(500).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
})

/**
 * Captures bounded application error reports for admin health diagnostics.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = errorLogSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const userId = await getOptionalUserId()
    const admin = createServiceRoleClient() as unknown as ErrorLogDb
    const { error } = await admin.from('error_logs').insert({
      user_id: userId,
      source: parsed.data.source,
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      path: parsed.data.path ?? request.headers.get('referer'),
      user_agent: request.headers.get('user-agent'),
      metadata: parsed.data.metadata ?? {},
    })

    if (error) {
      console.error('Error log insert failed:', error)
      return NextResponse.json({ error: 'Failed to record error' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error log route failed:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function getOptionalUserId(): Promise<string | null> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    return user?.id ?? null
  } catch {
    return null
  }
}
