import Link from 'next/link'
import { ArrowRight, Building2, Sparkles, Store, Ticket } from 'lucide-react'

const portals = [
  {
    href: '/login/builder',
    title: 'Event Creator',
    description:
      'Plan events, invite collaborators, book venues + vendors, and watch ticket revenue vs costs in real time.',
    icon: Ticket,
    accent: 'from-primary to-primary/60',
  },
  {
    href: '/login/venue',
    title: 'Venue Owner',
    description:
      'Show off your space, set house rules and kickback rates, and manage one calendar that prevents double-bookings.',
    icon: Building2,
    accent: 'from-secondary to-primary',
  },
  {
    href: '/login/vendor',
    title: 'Vendor',
    description:
      'List your services, set your rates and deposit terms, and opt in to emergency last-minute gigs.',
    icon: Store,
    accent: 'from-accent to-secondary',
  },
]

export default async function LoginChooserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const params = await searchParams
  const message = params.message

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-gradient-mesh opacity-60" />

      <div className="relative w-full max-w-7xl">
        {/* Logo */}
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl font-bold tracking-tight">3rdSpace</span>
          </Link>
          <h1 className="mt-2 font-display text-4xl font-bold">Welcome back</h1>
          <p className="text-muted-foreground">Each account type signs in through its own portal.</p>
        </div>

        {message && (
          <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {portals.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className="group relative flex min-h-[300px] flex-col overflow-hidden rounded-3xl border border-border bg-gradient-card p-7 shadow-card transition-smooth hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow md:min-h-[360px]"
            >
              {/* Accent glow */}
              <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${portal.accent} opacity-25 blur-2xl transition-smooth group-hover:opacity-50`} />

              <div className="relative flex flex-1 flex-col">
                <div className="mb-8 flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                    <portal.icon className="h-7 w-7 text-primary-foreground" />
                  </div>
                </div>

                <h2 className="font-display text-2xl font-bold md:text-3xl">{portal.title}</h2>
                <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                  {portal.description}
                </p>

                <div className="mt-auto flex items-center gap-2 pt-8 text-base font-semibold text-primary">
                  Sign in <ArrowRight className="h-5 w-5 transition-smooth group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Need to create an account?{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Sign up here
          </Link>
        </p>
      </div>
    </div>
  )
}
