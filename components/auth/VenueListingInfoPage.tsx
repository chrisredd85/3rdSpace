import Link from 'next/link'
import { Building2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const venueBenefits = [
  'Free curated listing — no upfront fees',
  'Leads from verified SF event organizers',
  'You set your rates, minimums, and Community Host Incentive terms',
]

/**
 * Renders the venue listing info and application page for supply-side prospects.
 *
 * @returns Static server-rendered venue listing info page.
 */
export function VenueListingInfoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className={cn('w-full max-w-2xl rounded-lg border border-border bg-card p-8 shadow-lg md:p-10')}>
        <div className="space-y-7">
          <Link href="/" className="inline-flex text-sm text-muted-foreground transition-smooth hover:text-foreground">
            &larr; Back
          </Link>

          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <Building2 className="h-8 w-8 text-primary-foreground" />
          </div>

          <div className="space-y-3">
            <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
              List your venue on 3rdPlace
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              3rdPlace curates a select group of Bay Area venues for SF Tech Week hosts,
              startup organizers, and private event leads. Listings are free.
            </p>
          </div>

          <div className="space-y-3">
            <p className="font-display text-sm font-semibold text-foreground">What you get</p>
            <div className="space-y-3">
              {venueBenefits.map((benefit) => (
                <div key={benefit} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Button variant="hero" size="lg" asChild>
              <a href="mailto:venues@3rdplace.io">Apply to list your venue</a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Already listed? Check your email for a claim link.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
