import Link from 'next/link'
import { Check, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const vendorBenefits = [
  'Free listing — no monthly fees at launch',
  'Booked by verified event hosts, not the public',
  'You control your packages, deposits, and lead time',
]

/**
 * Renders the vendor listing info and application page for supply-side prospects.
 *
 * @returns Static server-rendered vendor listing info page.
 */
export function VendorListingInfoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <section className={cn('w-full max-w-2xl rounded-lg border border-border bg-card p-8 shadow-lg md:p-10')}>
        <div className="space-y-7">
          <Link href="/" className="inline-flex text-sm text-muted-foreground transition-smooth hover:text-foreground">
            &larr; Back
          </Link>

          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
            <Store className="h-8 w-8 text-primary-foreground" />
          </div>

          <div className="space-y-3">
            <h1 className="font-display text-3xl font-semibold text-foreground md:text-4xl">
              Join 3rdPlace as a vendor
            </h1>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              We&apos;re building a curated network of Bay Area caterers, AV crews,
              photographers, DJs, security, and staffing. Free to join.
            </p>
          </div>

          <div className="space-y-3">
            <p className="font-display text-sm font-semibold text-foreground">What you get</p>
            <div className="space-y-3">
              {vendorBenefits.map((benefit) => (
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
              <a href="mailto:vendors@3rdspace.com">Apply to list as a vendor</a>
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
