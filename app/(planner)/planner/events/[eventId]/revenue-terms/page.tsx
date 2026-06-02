import { RevenueTermsTab } from '@/components/planner/RevenueTermsTab'

export const dynamic = 'force-dynamic'

export default function EventRevenueTermsPage({
  params,
}: {
  params: { eventId: string }
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Event finance
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
            Revenue terms
          </h1>
        </div>
        <RevenueTermsTab eventId={params.eventId} />
      </section>
    </main>
  )
}
