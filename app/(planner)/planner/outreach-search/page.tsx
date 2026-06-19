import { PlacesOutreachSearchWorkspace } from '@/components/planner/PlacesOutreachSearchWorkspace'

type PlannerOutreachSearchPageProps = {
  searchParams?: {
    plan?: string
  }
}

export default function PlannerOutreachSearchPage({ searchParams }: PlannerOutreachSearchPageProps) {
  return <PlacesOutreachSearchWorkspace initialPlanId={searchParams?.plan ?? null} />
}
