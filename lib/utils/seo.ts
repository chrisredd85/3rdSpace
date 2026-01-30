/**
 * SEO utilities for generating structured data and metadata
 */

export interface OrganizationSchema {
  name: string
  url: string
  logo?: string
  description?: string
  contactPoint?: {
    telephone?: string
    contactType?: string
    email?: string
  }
  sameAs?: string[]
}

export interface EventSchema {
  name: string
  description?: string
  startDate: string
  endDate?: string
  location?: {
    name?: string
    address?: {
      streetAddress?: string
      addressLocality?: string
      addressRegion?: string
      postalCode?: string
    }
  }
  organizer?: {
    name?: string
    url?: string
  }
  image?: string
  eventStatus?: string
  eventAttendanceMode?: string
}

export interface LocalBusinessSchema {
  name: string
  description?: string
  address?: {
    streetAddress?: string
    addressLocality?: string
    addressRegion?: string
    postalCode?: string
  }
  telephone?: string
  image?: string
  priceRange?: string
  servesCuisine?: string
  openingHours?: string
}

/**
 * Generate Organization JSON-LD schema
 */
export function generateOrganizationSchema(data: OrganizationSchema): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: data.name,
    url: data.url,
    ...(data.logo && { logo: data.logo }),
    ...(data.description && { description: data.description }),
    ...(data.contactPoint && {
      contactPoint: {
        '@type': 'ContactPoint',
        ...data.contactPoint,
      },
    }),
    ...(data.sameAs && { sameAs: data.sameAs }),
  }

  return JSON.stringify(schema)
}

/**
 * Generate Event JSON-LD schema
 */
export function generateEventSchema(data: EventSchema): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: data.name,
    ...(data.description && { description: data.description }),
    startDate: data.startDate,
    ...(data.endDate && { endDate: data.endDate }),
    ...(data.location && {
      location: {
        '@type': data.location.address ? 'Place' : 'VirtualLocation',
        ...(data.location.name && { name: data.location.name }),
        ...(data.location.address && {
          address: {
            '@type': 'PostalAddress',
            ...data.location.address,
          },
        }),
      },
    }),
    ...(data.organizer && {
      organizer: {
        '@type': 'Organization',
        ...data.organizer,
      },
    }),
    ...(data.image && { image: data.image }),
    ...(data.eventStatus && { eventStatus: data.eventStatus }),
    ...(data.eventAttendanceMode && {
      eventAttendanceMode: data.eventAttendanceMode,
    }),
  }

  return JSON.stringify(schema)
}

/**
 * Generate LocalBusiness JSON-LD schema
 */
export function generateLocalBusinessSchema(data: LocalBusinessSchema): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: data.name,
    ...(data.description && { description: data.description }),
    ...(data.address && {
      address: {
        '@type': 'PostalAddress',
        ...data.address,
      },
    }),
    ...(data.telephone && { telephone: data.telephone }),
    ...(data.image && { image: data.image }),
    ...(data.priceRange && { priceRange: data.priceRange }),
    ...(data.servesCuisine && { servesCuisine: data.servesCuisine }),
    ...(data.openingHours && { openingHours: data.openingHours }),
  }

  return JSON.stringify(schema)
}

/**
 * Generate BreadcrumbList JSON-LD schema
 */
export function generateBreadcrumbSchema(items: Array<{ name: string; url: string }>): string {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return JSON.stringify(schema)
}
