import { redirect } from 'next/navigation'

import { DeleteAccountPanel } from '@/components/privacy/DeleteAccountPanel'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function DeleteAccountPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/planner/settings/delete-account')
  }

  const { data } = await supabase
    .from('data_deletion_requests')
    .select('id,status,cooling_off_ends_at,requested_at,reason')
    .eq('user_id', user.id)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <DeleteAccountPanel initialRequest={data ?? null} />
    </div>
  )
}
