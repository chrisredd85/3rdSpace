import 'server-only'

import { buildFieldConfidence, type FieldConfidence } from '@/lib/integrations/csv/parse'

export type ScrapedEventPage = {
  url: string
  title: string | null
  event_name: string | null
  event_date: string | null
  start_time: string | null
  end_time: string | null
  description: string | null
  venue_name: string | null
  cover_image_url: string | null
  field_confidence: FieldConfidence
  raw: {
    og: Record<string, string>
    jsonLdEvents: Array<Record<string, unknown>>
  }
}

const MAX_HTML_BYTES = 1_000_000

export async function scrapeEventPage(urlInput: string): Promise<ScrapedEventPage> {
  const url = normalizePublicUrl(urlInput)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(url.toString(), {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': '3rdPlace event import bot',
      },
      signal: controller.signal,
      cache: 'no-store',
    })

    if (!response.ok) throw new Error(`Event page returned ${response.status}`)

    const html = (await response.text()).slice(0, MAX_HTML_BYTES)
    return parseEventPageHtml(url.toString(), html)
  } finally {
    clearTimeout(timeout)
  }
}

export function parseEventPageHtml(url: string, html: string): ScrapedEventPage {
  const og = parseMetaTags(html)
  const title = decodeHtml(readTitle(html) ?? og['og:title'] ?? og.title ?? '')
  const jsonLdEvents = parseJsonLdEvents(html)
  const jsonLdEvent = jsonLdEvents[0] ?? null
  const name = readJsonLdString(jsonLdEvent, 'name') ?? og['og:title'] ?? title ?? null
  const description = readJsonLdString(jsonLdEvent, 'description') ?? og['og:description'] ?? og.description ?? null
  const start = readJsonLdString(jsonLdEvent, 'startDate')
  const end = readJsonLdString(jsonLdEvent, 'endDate')
  const venueName = readVenueName(jsonLdEvent)
  const coverImage = readJsonLdImage(jsonLdEvent) ?? og['og:image'] ?? null
  const startParts = splitDateTime(start)
  const endParts = splitDateTime(end)
  const fieldConfidence = {
    ...buildFieldConfidence(
      [
        ...(name ? ['event_name'] : []),
        ...(description ? ['description'] : []),
        ...(venueName ? ['venue_name'] : []),
        ...(coverImage ? ['cover_image_url'] : []),
      ],
      jsonLdEvent ? 'high' : 'medium',
      jsonLdEvent ? 'json_ld' : 'open_graph'
    ),
    ...buildFieldConfidence(
      [
        ...(startParts.date ? ['event_date'] : []),
        ...(startParts.time ? ['start_time'] : []),
        ...(endParts.time ? ['end_time'] : []),
      ],
      start || end ? 'high' : 'low',
      start || end ? 'json_ld' : 'manual_required'
    ),
  }

  return {
    url,
    title: title || null,
    event_name: name ? decodeHtml(stripTags(name)) : null,
    event_date: startParts.date,
    start_time: startParts.time,
    end_time: endParts.time,
    description: description ? decodeHtml(stripTags(description)) : null,
    venue_name: venueName ? decodeHtml(stripTags(venueName)) : null,
    cover_image_url: coverImage,
    field_confidence: fieldConfidence,
    raw: {
      og,
      jsonLdEvents,
    },
  }
}

function normalizePublicUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Event URL must be http or https')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw new Error('Event URL must be publicly reachable')
  }

  return url
}

function parseMetaTags(html: string) {
  const result: Record<string, string> = {}
  const metaRegex = /<meta\b[^>]*>/gi
  for (const match of html.matchAll(metaRegex)) {
    const tag = match[0]
    const key = readAttribute(tag, 'property') ?? readAttribute(tag, 'name')
    const content = readAttribute(tag, 'content')
    if (key && content) result[key] = decodeHtml(content)
  }
  return result
}

function readTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.trim() ?? null
}

function parseJsonLdEvents(html: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  const events: Array<Record<string, unknown>> = []

  for (const match of scripts) {
    const raw = decodeHtml(match[1]?.trim() ?? '')
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      events.push(...extractEventObjects(parsed))
    } catch {
      // Ignore malformed vendor JSON-LD. OG tags still provide fallback fields.
    }
  }

  return events
}

function extractEventObjects(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(extractEventObjects)

  const record = value as Record<string, unknown>
  const type = record['@type']
  const types = Array.isArray(type) ? type : [type]
  const isEvent = types.some((item) => typeof item === 'string' && item.toLowerCase() === 'event')
  const nestedGraph = record['@graph']

  return [
    ...(isEvent ? [record] : []),
    ...(Array.isArray(nestedGraph) ? nestedGraph.flatMap(extractEventObjects) : []),
  ]
}

function readJsonLdString(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readVenueName(source: Record<string, unknown> | null) {
  const location = source?.location
  if (!location || typeof location !== 'object' || Array.isArray(location)) return null
  return readJsonLdString(location as Record<string, unknown>, 'name')
}

function readJsonLdImage(source: Record<string, unknown> | null) {
  const image = source?.image
  if (typeof image === 'string') return image
  if (Array.isArray(image)) {
    return image.find((item): item is string => typeof item === 'string') ?? null
  }
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    return readJsonLdString(image as Record<string, unknown>, 'url')
  }
  return null
}

function splitDateTime(value: string | null) {
  if (!value) return { date: null, time: null }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?))?/)
  if (!match) return { date: null, time: null }
  return {
    date: match[1] ?? null,
    time: normalizeTime(match[2] ?? null),
  }
}

function normalizeTime(value: string | null) {
  if (!value) return null
  const [hour = '18', minute = '00', second = '00'] = value.split(':')
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.slice(0, 2).padStart(2, '0')}`
}

function readAttribute(tag: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`${escapedName}\\s*=\\s*["']([^"']+)["']`, 'i')
  return tag.match(regex)?.[1]?.trim() ?? null
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
