import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

type Props = {
  params: { eventId: string }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const supabase = createClient()
  const { data: event } = await supabase
    .from('events')
    .select('title, description, event_date, event_type')
    .eq('id', params.eventId)
    .single()

  if (!event) {
    return {
      title: 'Event Not Found',
      description: 'The requested event could not be found.',
    }
  }

  const eventDate = event.event_date
    ? new Date(event.event_date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : ''

  return {
    title: event.title || 'Event',
    description:
      event.description ||
      `Event on ${eventDate}. ${event.event_type ? `Type: ${event.event_type}` : ''}`,
    openGraph: {
      title: `${event.title} | 3rdSpace`,
      description:
        event.description ||
        `Join us for ${event.title} on ${eventDate}`,
      type: 'website',
      images: [
        {
          url: '/og-default.png',
          width: 1200,
          height: 630,
          alt: event.title || 'Event',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${event.title} | 3rdSpace`,
      description:
        event.description ||
        `Join us for ${event.title} on ${eventDate}`,
    },
  }
}

export default function EventLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
