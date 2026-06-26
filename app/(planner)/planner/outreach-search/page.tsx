import { PlacesOutreachSearchWorkspace } from '@/components/planner/PlacesOutreachSearchWorkspace'

type PlannerOutreachSearchPageProps = {
  searchParams?: Promise<{
    plan?: string
  }>
}

export default async function PlannerOutreachSearchPage(props: PlannerOutreachSearchPageProps) {
  const searchParams = await props.searchParams;
  const resolvedSearchParams = searchParams ? await searchParams : {}
  return <PlacesOutreachSearchWorkspace initialPlanId={resolvedSearchParams.plan ?? null} />
}
