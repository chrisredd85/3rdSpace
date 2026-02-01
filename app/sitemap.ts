import { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://3rdspace.com'
  const supabase = createClient()

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${baseUrl}/signup`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  // Fetch public venues
  const { data: venues } = await supabase
    .from('venues')
    .select('id, updated_at')
    .eq('is_active', true)
    .eq('is_verified', true)
    .limit(1000) // Limit to prevent timeout

  type SitemapRow = { id: string; updated_at?: string }
  const venuePages: MetadataRoute.Sitemap =
    (venues || []).map((venue: SitemapRow) => ({
      url: `${baseUrl}/venues/${venue.id}`,
      lastModified: venue.updated_at ? new Date(venue.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

  // Fetch public vendors
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, updated_at')
    .eq('is_active', true)
    .eq('is_verified', true)
    .limit(1000)

  const vendorPages: MetadataRoute.Sitemap =
    (vendors || []).map((vendor: SitemapRow) => ({
      url: `${baseUrl}/vendors/${vendor.id}`,
      lastModified: vendor.updated_at ? new Date(vendor.updated_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))

  // Fetch public events (if you have public event pages)
  const { data: events } = await supabase
    .from('events')
    .select('id, updated_at')
    .in('status', ['confirmed', 'in_progress'])
    .limit(500)

  const eventPages: MetadataRoute.Sitemap =
    (events || []).map((event: SitemapRow) => ({
      url: `${baseUrl}/events/${event.id}`,
      lastModified: event.updated_at ? new Date(event.updated_at) : new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }))

  return [...staticPages, ...venuePages, ...vendorPages, ...eventPages]
}
