export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ACCOUNT_PUBLIC_SELECT = 'id, provider, email_address, token_expires_at, created_at, revoked_at'

/**
 * Returns the current creator Gmail connection state.
 */
export async function GET() {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const { data, error } = await auth.db
    .from('creator_email_accounts')
    .select(ACCOUNT_PUBLIC_SELECT)
    .eq('user_id', auth.userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[gmail.account] Lookup failed', error)
    return NextResponse.json({ error: 'Failed to load Gmail connection' }, { status: 500 })
  }

  return NextResponse.json({ account: data ?? null })
}

/**
 * Revokes the local Gmail connection. Google token revocation can be added later.
 */
export async function DELETE() {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const { error } = await auth.db
    .from('creator_email_accounts')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', auth.userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)

  if (error) {
    console.error('[gmail.account] Disconnect failed', error)
    return NextResponse.json({ error: 'Failed to disconnect Gmail' }, { status: 500 })
  }

  return NextResponse.json({ account: null })
}

async function getCreatorAuth() {
  const supabase = createClient()
  const db = supabase as any
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}
