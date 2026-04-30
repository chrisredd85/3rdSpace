'use client'

import { useRouter } from 'next/navigation'
import {
  Users,
  DollarSign,
  Calendar,
  Plus,
  Sparkles,
  Users2,
  Gift,
  Coffee,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Template {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  guestCount: string
  budget: string
  services: string[]
}

const templates: Template[] = [
  {
    id: 'networking-mixer',
    name: 'Networking Mixer',
    description: 'Perfect for professional networking events and meetups',
    icon: Users,
    guestCount: '50-100',
    budget: '$2,000 - $5,000',
    services: ['Catering', 'Bartending', 'AV/Tech'],
  },
  {
    id: 'all-hands',
    name: 'All Hands Meeting',
    description: 'Company-wide meetings and announcements',
    icon: Users2,
    guestCount: '100-500',
    budget: '$5,000 - $15,000',
    services: ['AV/Tech', 'Catering', 'Event Planning'],
  },
  {
    id: 'holiday-party',
    name: 'Holiday Party',
    description: 'Celebrate the season with your team',
    icon: Gift,
    guestCount: '75-200',
    budget: '$5,000 - $20,000',
    services: ['DJ', 'Catering', 'Bartending', 'Photography', 'Florist'],
  },
  {
    id: 'workshop',
    name: 'Workshop',
    description: 'Educational sessions and training events',
    icon: Coffee,
    guestCount: '20-50',
    budget: '$1,000 - $3,000',
    services: ['AV/Tech', 'Catering', 'Event Planning'],
  },
]

export default function TemplatesPage() {
  const router = useRouter()

  const handleUseTemplate = (templateId: string) => {
    router.push(`/builder/event/new?template=${templateId}`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Event Templates</h1>
        <p className="text-muted-foreground mt-1">Start planning faster with pre-configured event templates</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => {
          const Icon = template.icon
          return (
            <Card
              key={template.id}
              className="hover:shadow-lg transition-shadow cursor-pointer"
              onClick={() => handleUseTemplate(template.id)}
            >
              <CardHeader>
                <div className="flex items-start justify-between mb-2">
                  <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shadow-glow">
                    <Icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <Icon className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <CardTitle className="text-xl">{template.name}</CardTitle>
                <CardDescription>{template.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Details */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>{template.guestCount} guests</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <DollarSign className="h-4 w-4" />
                    <span>{template.budget}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>Flexible dates</span>
                  </div>
                </div>

                {/* Included Services */}
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">Included Services:</p>
                  <div className="flex flex-wrap gap-2">
                    {template.services.map((service) => (
                      <span
                        key={service}
                        className="px-2 py-1 text-xs rounded-md bg-primary/10 text-primary"
                      >
                        {service}
                      </span>
                    ))}
                  </div>
                </div>

                <Button className="w-full" onClick={(e) => {
                  e.stopPropagation()
                  handleUseTemplate(template.id)
                }}>
                  Use Template
                </Button>
              </CardContent>
            </Card>
          )
        })}

        {/* Create Custom Template Card */}
        <Card
          className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-dashed border-border hover:border-primary"
          onClick={() => router.push('/builder/event/new')}
        >
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-16 w-16 rounded-full bg-sidebar-accent/40 flex items-center justify-center mb-4">
              <Plus className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <CardTitle className="text-xl mb-2">Create Custom</CardTitle>
            <CardDescription className="text-center mb-4">
              Start from scratch and build your own event template
            </CardDescription>
            <Button variant="outline" onClick={(e) => {
              e.stopPropagation()
              router.push('/builder/event/new')
            }}>
              Create Event
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
