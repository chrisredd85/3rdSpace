import { permanentRedirect } from 'next/navigation'

type LegacyEventPlanPageProps = {
  params: Promise<{
    planId: string
  }>
}

export default async function LegacyEventPlanPage({ params }: LegacyEventPlanPageProps) {
  const { planId } = await params
  permanentRedirect(`/planner/experiences/${encodeURIComponent(planId)}`)
}
