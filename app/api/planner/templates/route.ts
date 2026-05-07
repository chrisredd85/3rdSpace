export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

const TEMPLATE_SELECT_COLUMNS = `
  id,
  name,
  event_type,
  target_audience,
  guest_count_min,
  guest_count_max,
  budget_model,
  ticket_price_model,
  profit_assumptions,
  kickback_model,
  run_of_show,
  shopping_list,
  email_copy,
  export_copy,
  approval_checklist,
  historical_performance,
  created_at
`

type TemplateRow = {
  id: string
  name: string
  event_type: string | null
  target_audience: string | null
  guest_count_min: number | null
  guest_count_max: number | null
  budget_model: Json
  ticket_price_model: Json
  profit_assumptions: Json
  kickback_model: Json
  run_of_show: Json
  shopping_list: Json
  email_copy: string | null
  export_copy: string | null
  approval_checklist: Json
  historical_performance: Json
  created_at: string
}

type PlannerTemplate = {
  id: string
  name: string
  description: string | null
  snapshot: Json
  created_at: string
}

export async function GET() {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('templates')
      .select(TEMPLATE_SELECT_COLUMNS)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[agent.run] Planner templates GET failed', error)
      return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
    }

    return NextResponse.json({ templates: (data ?? []).map(normalizeTemplateRow) })
  } catch (error) {
    console.error('[agent.run] Planner templates GET unexpected error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

function normalizeTemplateRow(row: TemplateRow): PlannerTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.target_audience ?? row.event_type ?? row.export_copy,
    snapshot: {
      event_type: row.event_type,
      target_audience: row.target_audience,
      guest_count_min: row.guest_count_min,
      guest_count_max: row.guest_count_max,
      budget_model: row.budget_model,
      ticket_price_model: row.ticket_price_model,
      profit_assumptions: row.profit_assumptions,
      kickback_model: row.kickback_model,
      run_of_show: row.run_of_show,
      shopping_list: row.shopping_list,
      email_copy: row.email_copy,
      approval_checklist: row.approval_checklist,
      historical_performance: row.historical_performance,
    } as Json,
    created_at: row.created_at,
  }
}
