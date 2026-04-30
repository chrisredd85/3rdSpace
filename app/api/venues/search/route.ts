import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getUniqueFeatureTagOptions } from '@/lib/venues/unique-features'
import { normalizeVenues, VENUE_SELECT_COLUMNS } from '@/lib/venues/venue-adapter'

const MARKETPLACE_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

/**
 * Searches venue listings by unique feature tags and common marketplace filters.
 *
 * @route GET /api/venues/search?tags=rooftop,parking&location=...
 * @auth Public
 *
 * @param request - Search request with tags, location, capacity, and price filters.
 * @returns Matching venues and supported tag options.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { searchParams } = request.nextUrl

    const tagsParam = searchParams.get('tags')
    const location = searchParams.get('location')
    const minCapacity = searchParams.get('minCapacity')
    const maxPrice = searchParams.get('maxPrice')

    let query = supabase
      .from('venues')
      .select(VENUE_SELECT_COLUMNS)
      .eq('is_published', true)
      .order('created_at', { ascending: false })

    if (tagsParam) {
      const tags = tagsParam
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
      if (tags.length > 0) {
        query = query.overlaps('unique_features_tags', tags)
      }
    }

    if (location) {
      query = query.or(`city.ilike.%${location}%,state.ilike.%${location}%,address.ilike.%${location}%`)
    }

    if (minCapacity) {
      const parsedCapacity = z.coerce.number().int().positive().safeParse(minCapacity)
      if (parsedCapacity.success) {
        query = query.gte('standing_capacity', parsedCapacity.data)
      }
    }

    if (maxPrice) {
      const parsedPrice = z.coerce.number().min(0).safeParse(maxPrice)
      if (parsedPrice.success) {
        query = query.lte('hourly_rate', parsedPrice.data)
      }
    }

    const { data: venues, error } = await query

    if (error) {
      console.error('[venues.search] Failed to search venues', error)
      return NextResponse.json({ error: 'Failed to search venues' }, { status: 500 })
    }

    return NextResponse.json(
      {
        venues: normalizeVenues(venues as any[]),
        tag_options: getUniqueFeatureTagOptions(),
      },
      { headers: MARKETPLACE_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('[venues.search] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to search venues' }, { status: 500 })
  }
}
