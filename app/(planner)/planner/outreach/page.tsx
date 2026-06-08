import { redirect } from 'next/navigation'

/**
 * Outreach sends and replies are not a standalone product surface yet.
 * Keep inbound links on a real inbox instead of rendering placeholder outreach UI.
 */
export default function PlannerOutreachPage() {
  redirect('/planner/messages')
}
