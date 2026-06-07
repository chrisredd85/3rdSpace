export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { buildGmailOAuthUrl } from '@/lib/outreach/gmail'
import { createClient } from '@/lib/supabase/server'

/**
 * Starts creator Gmail OAuth for planner outreach sends.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const returnTo = request.nextUrl.searchParams.get('returnTo')
  return NextResponse.redirect(buildGmailOAuthUrl({
    userId: user.id,
    returnTo: returnTo && returnTo.startsWith('/') ? returnTo : '/planner/settings/integrations',
  }))
}
