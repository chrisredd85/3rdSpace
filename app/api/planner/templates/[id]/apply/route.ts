export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

type DbError = { message: string }
type TemplateIdRow = { id: string }
type InsertTemplateRun = (values: {
  template_id: string
  plan_id: string
}) => Promise<{ error: DbError | null }>

const applyTemplateSchema = z.object({
  plan_id: z.string().uuid(),
})

interface RouteContext {
  params: {
    id: string
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = applyTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', context.params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (templateError) {
      console.error('[agent.run] Planner template apply load failed', templateError)
      return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
    }

    const templateRow = template as TemplateIdRow | null
    if (!templateRow) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id')
      .eq('id', parsed.data.plan_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (planError) {
      console.error('[agent.run] Planner template apply plan load failed', planError)
      return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 })
    }

    const planRow = plan as TemplateIdRow | null
    if (!planRow) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const insertTemplateRun = supabase.from('template_runs').insert as unknown as InsertTemplateRun
    const { error: insertError } = await insertTemplateRun({
      template_id: templateRow.id,
      plan_id: planRow.id,
    })

    if (insertError) {
      console.error('[agent.run] Planner template apply insert failed', insertError)
      return NextResponse.json({ error: 'Failed to apply template' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[agent.run] Planner template apply unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
