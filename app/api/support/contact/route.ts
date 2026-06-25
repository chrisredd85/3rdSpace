export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import {
  generateSupportTicketId,
  sendSupportTicketEmail,
  type SupportPlanSummary,
} from '@/lib/server/support-tickets'
import { SUPPORT_CATEGORIES, SUPPORT_SEVERITIES } from '@/lib/support/tickets'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const supportContactSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(8000),
  severity: z.enum(SUPPORT_SEVERITIES).default('medium'),
  related_plan_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().optional(),
  current_url: z.string().trim().max(500).optional(),
})

type SupportTicketInsert = {
  ticket_id: string
  user_id: string | null
  email: string
  name: string | null
  category: string
  subject: string
  description: string
  severity: string
  related_plan_id: string | null
  metadata: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const admin = createServiceRoleClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const parsed = supportContactSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid support request', details: parsed.error.flatten() }, { status: 400 })
  }

  const email = user?.email ?? parsed.data.email
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const rateKey = user?.id ? `support:user:${user.id}` : `support:email:${email.toLowerCase()}:${getIpAddress(request)}`
  const rateLimit = await checkRateLimit(rateKey, { limit: 5, windowMs: 60 * 60 * 1000 })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many support requests. Please wait before submitting another ticket.' },
      { status: 429, headers: rateLimitHeaders(rateLimit) }
    )
  }

  const relatedPlan = parsed.data.related_plan_id
    ? await loadOwnedPlanSummary(admin, parsed.data.related_plan_id, user?.id ?? null)
    : null

  if (parsed.data.related_plan_id && !relatedPlan) {
    return NextResponse.json({ error: 'Related plan not found' }, { status: 404 })
  }

  const ticketId = generateSupportTicketId()
  const metadata = {
    auth: user ? 'authenticated' : 'public',
    current_url: parsed.data.current_url ?? null,
    user_agent: request.headers.get('user-agent'),
    ip_address: getIpAddress(request),
    related_plan: relatedPlan,
  }
  const insertPayload: SupportTicketInsert = {
    ticket_id: ticketId,
    user_id: user?.id ?? null,
    email,
    name: parsed.data.name?.trim() || user?.user_metadata?.name || null,
    category: parsed.data.category,
    subject: parsed.data.subject,
    description: parsed.data.description,
    severity: parsed.data.severity,
    related_plan_id: relatedPlan?.id ?? null,
    metadata,
  }

  const { data: ticket, error: insertError } = await (admin as any)
    .from('support_tickets')
    .insert(insertPayload)
    .select('*')
    .single()

  if (insertError || !ticket) {
    console.error('[support.contact] Failed to create support ticket', insertError)
    return NextResponse.json({ error: 'Failed to create support ticket' }, { status: 500 })
  }

  let emailForwarded = false
  let emailError: string | null = null
  try {
    const emailResult = await sendSupportTicketEmail({
      ticketId,
      category: parsed.data.category,
      severity: parsed.data.severity,
      subject: parsed.data.subject,
      description: parsed.data.description,
      email,
      name: insertPayload.name,
      userId: user?.id ?? null,
      relatedPlan,
      metadata,
    })
    emailForwarded = Boolean(emailResult.sent)
    if (!emailResult.sent) emailError = emailResult.reason ?? 'Email provider not configured'
  } catch (error) {
    emailError = error instanceof Error ? error.message : 'Email forward failed'
  }

  await (admin as any)
    .from('support_tickets')
    .update({
      metadata: {
        ...metadata,
        email_forwarded: emailForwarded,
        email_error: emailError,
      },
    })
    .eq('id', ticket.id)

  return NextResponse.json({
    ticket_id: ticketId,
    email_forwarded: emailForwarded,
    email_error: emailError,
  }, { status: 201 })
}

async function loadOwnedPlanSummary(
  admin: ReturnType<typeof createServiceRoleClient>,
  planId: string,
  userId: string | null
): Promise<SupportPlanSummary | null> {
  if (!userId) return null

  const { data, error } = await (admin as any)
    .from('plans')
    .select('id, title, status, event_type, date_window_start, date_window_end')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[support.contact] Failed to load related plan', error)
    return null
  }

  return data as SupportPlanSummary | null
}

function getIpAddress(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
