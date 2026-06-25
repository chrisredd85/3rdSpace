import { redirect } from 'next/navigation'
import { AdminSupportInbox } from '@/components/support/AdminSupportInbox'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { SupportTicketRow } from '@/lib/support/tickets'

export const dynamic = 'force-dynamic'

export default async function AdminSupportPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data } = await (admin as any)
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  const tickets = ((data ?? []) as SupportTicketRow[]).sort(sortTickets)
  return <AdminSupportInbox initialTickets={tickets} />
}

function sortTickets(a: SupportTicketRow, b: SupportTicketRow) {
  const statusWeight = (status: string) => status === 'open' ? 0 : status === 'in_progress' ? 1 : 2
  const severityWeight = (severity: string) => severity === 'urgent' ? 0 : severity === 'high' ? 1 : severity === 'medium' ? 2 : 3
  return (
    statusWeight(a.status) - statusWeight(b.status) ||
    severityWeight(a.severity) - severityWeight(b.severity) ||
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}
