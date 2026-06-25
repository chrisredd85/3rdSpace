export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/server'

const REDACTED = '[redacted by 3rdPlace data retention policy]'

function yearsAgo(years: number) {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  return date.toISOString()
}

async function runCleanupStep(label: string, fn: () => Promise<{ count?: number | null; error?: { message?: string } | null }>) {
  const result = await fn()
  if (result.error) {
    return { label, ok: false, count: 0, error: result.error.message ?? 'Cleanup failed' }
  }
  return { label, ok: true, count: result.count ?? 0 }
}

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceRoleClient() as any
  const oneYearAgo = yearsAgo(1)
  const twoYearsAgo = yearsAgo(2)

  const steps = await Promise.all([
    runCleanupStep('discovery_venues_contact_fields', () =>
      admin
        .from('discovery_venues')
        .update({
          contact_email: null,
          contact_phone: null,
          organizer_provided_emails: [],
          extracted_emails: [],
          website_extraction_metadata: {
            redacted_at: new Date().toISOString(),
            retention_policy: 'discovery_contact_data_1_year_unused',
          },
        })
        .lt('updated_at', oneYearAgo)
        .select('id', { count: 'exact', head: true })
    ),
    runCleanupStep('venue_outreach_responses', () =>
      admin
        .from('venue_outreach_responses')
        .delete()
        .lt('extracted_at', twoYearsAgo)
        .select('id', { count: 'exact', head: true })
    ),
    runCleanupStep('vendor_outreach_responses', () =>
      admin
        .from('vendor_outreach_responses')
        .delete()
        .lt('extracted_at', twoYearsAgo)
        .select('id', { count: 'exact', head: true })
    ),
    runCleanupStep('outreach_messages_body_redaction', () =>
      admin
        .from('outreach_messages')
        .update({
          subject: REDACTED,
          body_text: REDACTED,
          body_html: null,
          transcript_text: null,
          headers_json: {},
          provider_metadata_json: {},
          attachments_json: [],
        })
        .lt('created_at', twoYearsAgo)
        .select('id', { count: 'exact', head: true })
    ),
  ])

  const failed = steps.filter((step) => !step.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    one_year_cutoff: oneYearAgo,
    two_year_cutoff: twoYearsAgo,
    steps,
  }, { status: failed.length > 0 ? 500 : 200 })
}
