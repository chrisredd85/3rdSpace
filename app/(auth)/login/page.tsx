import Link from 'next/link'
import { ArrowRight, Building2, Sparkles, Store, Ticket } from 'lucide-react'

const portals = [
  {
    href: '/login/builder',
    title: 'Event Creator',
    description: 'Events, collaborators, and bookings',
    icon: Ticket,
    accent: 'from-primary to-primary/60',
  },
  {
    href: '/login/venue',
    title: 'Venue Owner',
    description: 'Venue listings, requests, and availability',
    icon: Building2,
    accent: 'from-secondary to-primary',
  },
  {
    href: '/login/vendor',
    title: 'Vendor',
    description: 'Services, documents, and bookings',
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

      <div className="relative w-full max-w-4xl">
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

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {portals.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-gradient-card p-7 shadow-card transition-smooth hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow"
            >
              {/* Accent glow */}
              <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${portal.accent} opacity-25 blur-2xl transition-smooth group-hover:opacity-50`} />

              <div className="relative flex flex-1 flex-col">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-brand shadow-glow">
                    <portal.icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                </div>

                <h2 className="font-display text-xl font-bold">{portal.title}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{portal.description}</p>

                <div className="mt-6 flex items-center gap-1.5 text-sm font-medium text-primary">
                  Sign in <ArrowRight className="h-4 w-4 transition-smooth group-hover:translate-x-1" />
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
