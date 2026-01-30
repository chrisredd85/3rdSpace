'use client'

import { generateEventSchema, generateLocalBusinessSchema, type EventSchema, type LocalBusinessSchema } from '@/lib/utils/seo'

interface StructuredDataProps {
  type: 'event' | 'localBusiness'
  data: EventSchema | LocalBusinessSchema
}

/**
 * StructuredData component for adding JSON-LD schema
 * 
 * @example
 * ```tsx
 * <StructuredData
 *   type="event"
 *   data={{
 *     name: "Networking Mixer",
 *     startDate: "2024-01-15T18:00:00",
 *     location: { name: "Venue Name" }
 *   }}
 * />
 * ```
 */
export function StructuredData({ type, data }: StructuredDataProps) {
  const schema =
    type === 'event'
      ? generateEventSchema(data as EventSchema)
      : generateLocalBusinessSchema(data as LocalBusinessSchema)

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: schema }}
    />
  )
}
