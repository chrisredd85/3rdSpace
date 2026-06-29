import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { PlannerExperienceBriefDetail } from '@/components/planner/PlannerExperienceBriefDetail'
import { PlannerMobileRouteHeader } from '@/components/planner/PlannerMobileRouteHeader'

export const dynamic = 'force-dynamic'

type ExperiencePlanBriefPageProps = {
  params: Promise<{
    planId: string
  }>
}

export default async function ExperiencePlanBriefPage({ params }: ExperiencePlanBriefPageProps) {
  const { planId } = await params

  return (
    <div className="min-h-full bg-cream text-ink">
      <PlannerMobileRouteHeader actionHref="/planner/experiences" actionLabel="Records" activeHref="/planner/experiences" />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink-soft">
          <Link href="/planner/experiences" className="transition-colors hover:text-clay">
            Experiences
          </Link>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="truncate text-ink">Event record</span>
        </nav>
        <PlannerExperienceBriefDetail planId={planId} />
      </main>
    </div>
  )
}
