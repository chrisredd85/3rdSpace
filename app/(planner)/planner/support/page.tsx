import { redirect } from 'next/navigation'
import { SupportContactForm } from '@/components/support/SupportContactForm'
import { createClient } from '@/lib/supabase/server'
import type { SupportPlanSummary } from '@/lib/support/tickets'

export const dynamic = 'force-dynamic'

export default async function PlannerSupportPage() {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect('/login/builder')

  const { data: plans } = await (supabase as any)
    .from('plans')
    .select('id, title, status, event_type, date_window_start, date_window_end')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(30)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <p className="label-caps text-clay-deep">Help & support</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Tell us what happened.</h1>
        <p className="mt-3 max-w-2xl text-ink-soft">
          Send the 3rdPlace team enough context to debug account, billing, planner, outreach, ticketing, or payment issues without a long back-and-forth.
        </p>
      </header>

      <SupportContactForm
        mode="planner"
        userEmail={user.email}
        userName={readUserName(user.user_metadata)}
        plans={(plans ?? []) as SupportPlanSummary[]}
      />
    </div>
  )
}

function readUserName(metadata: Record<string, unknown> | null | undefined) {
  const name = metadata?.name ?? metadata?.full_name
  return typeof name === 'string' ? name : null
}
