import Link from 'next/link'
import { ArrowRight, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="min-h-screen bg-background px-6 py-20 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col items-start">
        <Link href="/" className="font-display text-[24px] font-semibold tracking-tight text-clay">
          3rdPlace
        </Link>
        <p className="mt-16 label-caps text-clay-deep">Page not found</p>
        <h1 className="mt-4 font-display text-[48px] font-semibold leading-[1.02] text-ink sm:text-[72px]">
          This page doesn&apos;t exist.
        </h1>
        <p className="mt-5 max-w-xl text-[18px] leading-7 text-ink-soft">
          The event, approval, or page you opened may have moved. Head home or sign in to continue from your planner workspace.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-clay-deep"
          >
            <Home className="h-4 w-4" />
            Back to home
          </Link>
          <Link
            href="/login/builder"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-tan bg-cream px-5 text-[15px] font-semibold text-ink transition-colors hover:border-clay hover:text-clay-deep"
          >
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </main>
  )
}
