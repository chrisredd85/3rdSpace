'use client'

import { Calendar, Coffee, DollarSign, Gift, Plus, Users, Users2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface Template {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  guestCount: string
  budget: string
  services: string[]
  draft: string
}

const templates: Template[] = [
  {
    id: 'networking-mixer',
    name: 'Networking Mixer',
    description: 'Professional networking, founder mixers, and meetup-style gatherings.',
    icon: Users,
    guestCount: '50-100',
    budget: '$2,000 - $5,000',
    services: ['Venue', 'Bar package', 'Check-in'],
    draft: 'Plan a networking mixer for 80 people with drinks, check-in, and venue recommendations.',
  },
  {
    id: 'all-hands',
    name: 'All Hands',
    description: 'Company-wide talks, operator sessions, and investor updates.',
    icon: Users2,
    guestCount: '100-300',
    budget: '$5,000 - $15,000',
    services: ['AV', 'Catering', 'Venue'],
    draft: 'Plan an all-hands event for 150 people with AV, light food, and a central venue.',
  },
  {
    id: 'holiday-party',
    name: 'Holiday Party',
    description: 'Seasonal team events with music, drinks, and photo moments.',
    icon: Gift,
    guestCount: '75-200',
    budget: '$5,000 - $20,000',
    services: ['DJ', 'Catering', 'Photo', 'Bar'],
    draft: 'Plan a holiday party for 120 people with music, drinks, catering, and venue options.',
  },
  {
    id: 'workshop',
    name: 'Workshop',
    description: 'Hands-on classes, creator sessions, and small group learning.',
    icon: Coffee,
    guestCount: '20-50',
    budget: '$1,000 - $3,000',
    services: ['Venue', 'Supplies', 'AV'],
    draft: 'Plan a workshop for 35 people with seating, AV, supplies, and flexible dates.',
  },
]

/**
 * Planner-native event templates that start a new agent conversation.
 */
export default function PlannerTemplatesPage() {
  const router = useRouter()

  function useTemplate(template: Template) {
    router.push(`/planner?draft=${encodeURIComponent(template.draft)}`)
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">Start from a proven event shape, then let the agent refine it.</p>
      </div>

      <div className="grid gap-5 px-6 py-6 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => {
          const Icon = template.icon

          return (
            <Card key={template.id} className="cursor-pointer transition-shadow hover:shadow-card" onClick={() => useTemplate(template)}>
              <CardHeader>
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-brand shadow-glow">
                    <Icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                </div>
                <CardTitle className="text-xl">{template.name}</CardTitle>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>{template.guestCount} guests</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    <span>{template.budget}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Flexible dates</span>
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-foreground">Planning scope</p>
                  <div className="flex flex-wrap gap-2">
                    {template.services.map((service) => (
                      <span key={service} className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
                        {service}
                      </span>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={(event) => {
                    event.stopPropagation()
                    useTemplate(template)
                  }}
                >
                  Use Template
                </Button>
              </CardContent>
            </Card>
          )
        })}

        <Card className="cursor-pointer border-2 border-dashed border-border transition-shadow hover:border-primary hover:shadow-card" onClick={() => router.push('/planner')}>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sidebar-accent/40">
              <Plus className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <CardTitle className="mb-2 text-xl">Create Custom</CardTitle>
            <CardDescription className="mb-4 text-center">Describe your event in the planner and build from scratch.</CardDescription>
            <Button
              variant="outline"
              onClick={(event) => {
                event.stopPropagation()
                router.push('/planner')
              }}
            >
              Start Planning
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
