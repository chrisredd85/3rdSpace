import { redirect } from 'next/navigation'

/**
 * Local prototype routes live under this route group, but they contain hardcoded mock data.
 * Redirect the whole group so mock screens cannot be confused with production planner UI.
 */
export default function MobileMockupLayout() {
  redirect('/planner')
}
