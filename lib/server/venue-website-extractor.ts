import 'server-only'

import * as Sentry from '@sentry/nextjs'
import {
  disambiguateBookingContact,
  type ContactDisambiguationInput,
  type ContactDisambiguationResult,
} from '@/lib/ai/agents/contactDisambiguationAgent'

export const VENUE_WEBSITE_EXTRACTOR_USER_AGENT =
  '3rdPlace-Venue-Inquiry-Bot/1.0 (+https://www.3rdplace.io/bot-info)'

export const VENUE_CONTACT_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/about',
  '/events',
  '/private-events',
  '/book',
  '/booking',
  '/inquiries',
  '/host',
  '/venue',
  '/rentals',
] as const

export type WebsiteExtractionStatus =
  | 'successful'
  | 'no_emails_found'
  | 'fetch_failed'
  | 'blocked_by_robots'
  | 'rate_limited'
  | 'timeout'

export type ExtractedEmail = {
  email: string
  confidence: number
  source_path: string
  extracted_at: string
  is_likely_booking_contact: boolean
}

export type ExtractedContactForm = {
  url: string
  label: string
  confidence: number
  source_path: string
  extracted_at: string
  is_likely_booking_contact: boolean
}

export type ExtractionResult = {
  status: WebsiteExtractionStatus
  emails: ExtractedEmail[]
  contact_forms: ExtractedContactForm[]
  metadata: {
    paths_attempted: string[]
    paths_successful: string[]
    total_fetch_time_ms: number
    robots_txt_consulted: boolean
    error?: string
    disambiguation_error?: string
  }
}

export type EmailCandidate = {
  email: string
  source_path: string
  surrounding_context?: string
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>
type SleepLike = (ms: number) => Promise<void>
type DisambiguateLike = (input: ContactDisambiguationInput) => Promise<ContactDisambiguationResult>

export type ExtractVenueContactsOptions = {
  venueName?: string
  venueType?: string
  fetchImpl?: FetchLike
  now?: () => number
  sleep?: SleepLike
  disambiguate?: DisambiguateLike
  requestTimeoutMs?: number
  totalBudgetMs?: number
  maxRetries?: number
}

type FetchTextResult =
  | { status: 'ok'; text: string }
  | { status: 'not_found' }
  | { status: 'rate_limited' }
  | { status: 'timeout' }
  | { status: 'failed'; error: string }

type RobotsGroup = {
  agents: string[]
  rules: Array<{ directive: 'allow' | 'disallow'; path: string }>
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const REQUEST_TIMEOUT_MS = 8_000
const TOTAL_BUDGET_MS = 30_000
const MAX_RETRIES = 3
const RATE_LIMIT_INTERVAL_MS = 1_000
const TRANSIENT_BACKOFF_MS = [250, 500, 1_000]

const domainLastRequestAt = new Map<string, number>()
const domainQueues = new Map<string, Promise<void>>()

export async function extractVenueContacts(
  websiteUrl: string,
  options: ExtractVenueContactsOptions = {}
): Promise<ExtractionResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const metadata: ExtractionResult['metadata'] = {
    paths_attempted: [],
    paths_successful: [],
    total_fetch_time_ms: 0,
    robots_txt_consulted: false,
  }

  const finalize = (
    status: WebsiteExtractionStatus,
    emails: ExtractedEmail[] = [],
    contactForms: ExtractedContactForm[] = []
  ): ExtractionResult => ({
    status,
    emails,
    contact_forms: contactForms,
    metadata: {
      ...metadata,
      total_fetch_time_ms: Math.max(0, now() - startedAt),
    },
  })

  try {
    const baseUrl = normalizeWebsiteUrl(websiteUrl)
    if (!baseUrl) {
      metadata.error = 'Invalid website URL'
      return finalize('fetch_failed')
    }

    const requestContext = {
      fetchImpl: options.fetchImpl ?? fetch,
      sleep: options.sleep ?? defaultSleep,
      now,
      startedAt,
      requestTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      totalBudgetMs: options.totalBudgetMs ?? TOTAL_BUDGET_MS,
      maxRetries: options.maxRetries ?? MAX_RETRIES,
    }

    const robotsResult = await fetchRobotsTxt(baseUrl, requestContext)
    metadata.robots_txt_consulted = true
    if (robotsResult.status === 'rate_limited') return finalize('rate_limited')
    if (robotsResult.status === 'timeout') return finalize('timeout')

    const robotsText = robotsResult.status === 'ok' ? robotsResult.text : null
    const allowedPaths = VENUE_CONTACT_PATHS.filter((path) => (
      !robotsText || isPathAllowedByRobots(robotsText, VENUE_WEBSITE_EXTRACTOR_USER_AGENT, path)
    ))

    if (allowedPaths.length === 0) {
      metadata.error = 'robots.txt blocked all contact extraction paths'
      return finalize('blocked_by_robots')
    }

    const foundByEmail = new Map<string, EmailCandidate>()
    const foundContactForms = new Map<string, Omit<ExtractedContactForm, 'extracted_at'>>()
    let hadSuccessfulFetch = false
    let hadFetchFailure = false

    for (const path of allowedPaths) {
      if (isBudgetExpired(startedAt, now, requestContext.totalBudgetMs)) return finalize('timeout')

      metadata.paths_attempted.push(path)
      const pageResult = await fetchTextWithRetries(new URL(path, baseUrl), requestContext)
      if (pageResult.status === 'rate_limited') return finalize('rate_limited')
      if (pageResult.status === 'timeout') return finalize('timeout')
      if (pageResult.status === 'not_found') continue
      if (pageResult.status === 'failed') {
        hadFetchFailure = true
        metadata.error = pageResult.error
        continue
      }

      hadSuccessfulFetch = true
      metadata.paths_successful.push(path)
      for (const candidate of extractEmailsFromHtml(pageResult.text, path)) {
        const key = candidate.email.toLowerCase()
        const existing = foundByEmail.get(key)
        if (!existing || scoreEmailConfidence(candidate.email, path, true) > scoreEmailConfidence(existing.email, existing.source_path, true)) {
          foundByEmail.set(key, candidate)
        }
      }
      for (const form of extractContactFormsFromHtml(pageResult.text, path, new URL(path, baseUrl))) {
        const key = form.url.toLowerCase()
        const existing = foundContactForms.get(key)
        if (!existing || form.confidence > existing.confidence) {
          foundContactForms.set(key, form)
        }
      }
    }

    const extractedAt = new Date(now()).toISOString()
    const contactForms = Array.from(foundContactForms.values())
      .map((form) => ({
        ...form,
        extracted_at: extractedAt,
      }))
      .sort((a, b) => b.confidence - a.confidence || a.url.localeCompare(b.url))

    if (foundByEmail.size === 0) {
      if (!hadSuccessfulFetch && hadFetchFailure) return finalize('fetch_failed')
      return finalize('no_emails_found', [], contactForms)
    }

    const candidates = Array.from(foundByEmail.values())
    const emails = candidates
      .map((candidate) => ({
        email: candidate.email,
        confidence: scoreEmailConfidence(candidate.email, candidate.source_path, candidates.length > 1),
        source_path: candidate.source_path,
        extracted_at: extractedAt,
        is_likely_booking_contact: candidates.length === 1,
      }))
      .sort((a, b) => b.confidence - a.confidence || a.email.localeCompare(b.email))

    if (emails.length > 1) {
      try {
        const disambiguation = await (options.disambiguate ?? disambiguateBookingContact)({
          emails: candidates,
          venue_name: options.venueName ?? 'Unknown venue',
          venue_type: options.venueType ?? 'venue',
        })
        markLikelyBookingContact(emails, disambiguation)
      } catch (error) {
        metadata.disambiguation_error = error instanceof Error ? error.message : 'Contact disambiguation failed'
        Sentry.captureException(error, {
          tags: { component: 'venue_website_extractor', phase: 'contact_disambiguation' },
          extra: { venue_name: options.venueName ?? 'Unknown venue', email_count: emails.length },
        })
        markHighestConfidenceEmail(emails)
      }
    }

    return finalize('successful', emails, contactForms)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Venue website extraction failed'
    metadata.error = message
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extractor', phase: 'extract' },
    })
    console.error('[venue-website-extractor] extraction_failed', { error: message })
    return finalize('fetch_failed')
  }
}

export function extractEmailsFromHtml(html: string, sourcePath: string): EmailCandidate[] {
  const decoded = decodeHtmlEntities(html)
  const candidates = new Map<string, EmailCandidate>()

  for (const match of decoded.matchAll(EMAIL_PATTERN)) {
    const email = match[0]
    if (shouldSkipEmail(email)) continue

    const normalized = email.toLowerCase()
    if (candidates.has(normalized)) continue
    candidates.set(normalized, {
      email,
      source_path: sourcePath,
      surrounding_context: getSurroundingContext(decoded, match.index ?? 0, email.length),
    })
  }

  return Array.from(candidates.values())
}

export function extractContactFormsFromHtml(
  html: string,
  sourcePath: string,
  pageUrl: URL
): Array<Omit<ExtractedContactForm, 'extracted_at'>> {
  const decoded = decodeHtmlEntities(html)
  const candidates = new Map<string, Omit<ExtractedContactForm, 'extracted_at'>>()

  for (const match of decoded.matchAll(/<form\b[^>]*>/gi)) {
    const tag = match[0]
    const action = readHtmlAttribute(tag, 'action')
    const id = readHtmlAttribute(tag, 'id')
    const name = readHtmlAttribute(tag, 'name')
    const ariaLabel = readHtmlAttribute(tag, 'aria-label')
    if (isNonBookingForm(`${tag} ${action ?? ''} ${id ?? ''} ${name ?? ''} ${ariaLabel ?? ''}`)) continue
    const context = getSurroundingContext(decoded, match.index ?? 0, tag.length)
    const label = pickContactFormLabel([ariaLabel, id, name, context], 'Contact form')
    const absoluteUrl = toAbsoluteContactUrl(action || pageUrl.href, pageUrl)
    if (!absoluteUrl) continue

    const confidence = scoreContactFormConfidence(`${tag} ${context}`, sourcePath)
    if (confidence < 0.45) continue
    addContactFormCandidate(candidates, {
      url: absoluteUrl,
      label,
      source_path: sourcePath,
      confidence,
      is_likely_booking_contact: confidence >= 0.75,
    })
  }

  for (const match of decoded.matchAll(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2]
    const linkText = stripHtml(match[3])
    const tag = match[0]
    const absoluteUrl = toAbsoluteContactUrl(href, pageUrl)
    if (!absoluteUrl) continue
    const context = getSurroundingContext(decoded, match.index ?? 0, tag.length)
    const confidence = scoreContactFormConfidence(`${linkText} ${href} ${context}`, sourcePath)
    if (confidence < 0.55) continue
    addContactFormCandidate(candidates, {
      url: absoluteUrl,
      label: pickContactFormLabel([linkText, href], 'Contact form'),
      source_path: sourcePath,
      confidence,
      is_likely_booking_contact: confidence >= 0.75,
    })
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.confidence - a.confidence || a.url.localeCompare(b.url))
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
}

export function scoreEmailConfidence(email: string, sourcePath: string, hasAlternatives: boolean): number {
  const localPart = email.split('@')[0]?.toLowerCase() ?? ''
  const path = sourcePath.toLowerCase()
  let confidence = 0.5

  if (isPathMatch(path, ['/contact', '/contact-us'])) confidence += 0.2
  if (isPathMatch(path, ['/events', '/private-events', '/book', '/booking', '/inquiries'])) confidence += 0.2
  if (/(events?|book|private|inquir|manager|gm|owner)/i.test(localPart)) confidence += 0.1
  if (hasAlternatives && ['info', 'hello', 'contact'].includes(localPart)) confidence -= 0.2

  return Math.min(1, Math.max(0, Number(confidence.toFixed(2))))
}

export function parseRobotsTxt(robotsText: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let currentAgents: string[] = []
  let currentRules: RobotsGroup['rules'] = []

  const flush = () => {
    if (currentAgents.length > 0) {
      groups.push({ agents: currentAgents, rules: currentRules })
    }
    currentAgents = []
    currentRules = []
  }

  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? ''
    if (!line) {
      flush()
      continue
    }

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (key === 'user-agent') {
      if (currentRules.length > 0) flush()
      currentAgents.push(value.toLowerCase())
      continue
    }

    if ((key === 'allow' || key === 'disallow') && currentAgents.length > 0) {
      currentRules.push({ directive: key, path: value })
    }
  }

  flush()
  return groups
}

export function isPathAllowedByRobots(robotsText: string, userAgent: string, path: string): boolean {
  const groups = parseRobotsTxt(robotsText)
  if (groups.length === 0) return true

  const matchingGroups = getMatchingRobotsGroups(groups, userAgent)
  if (matchingGroups.length === 0) return true

  let strongestRule: { directive: 'allow' | 'disallow'; path: string } | null = null

  for (const group of matchingGroups) {
    for (const rule of group.rules) {
      if (rule.path === '' && rule.directive === 'disallow') continue
      if (!robotsRuleMatchesPath(rule.path, path)) continue
      if (!strongestRule || rule.path.length > strongestRule.path.length) {
        strongestRule = rule
      } else if (strongestRule.path.length === rule.path.length && rule.directive === 'allow') {
        strongestRule = rule
      }
    }
  }

  return strongestRule?.directive !== 'disallow'
}

export function clearVenueWebsiteRateLimits() {
  domainLastRequestAt.clear()
  domainQueues.clear()
}

function normalizeWebsiteUrl(websiteUrl: string): URL | null {
  const trimmed = websiteUrl.trim()
  if (!trimmed) return null

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const parsed = new URL(withProtocol)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    return new URL(parsed.origin)
  } catch {
    return null
  }
}

async function fetchRobotsTxt(
  baseUrl: URL,
  context: Required<Pick<ExtractVenueContactsOptions, 'now' | 'sleep' | 'fetchImpl'>> & {
    startedAt: number
    requestTimeoutMs: number
    totalBudgetMs: number
    maxRetries: number
  }
): Promise<FetchTextResult> {
  const result = await fetchTextWithRetries(new URL('/robots.txt', baseUrl), { ...context, maxRetries: 0 })
  if (result.status === 'not_found' || result.status === 'failed') return { status: 'not_found' }
  return result
}

async function fetchTextWithRetries(
  url: URL,
  context: Required<Pick<ExtractVenueContactsOptions, 'now' | 'sleep' | 'fetchImpl'>> & {
    startedAt: number
    requestTimeoutMs: number
    totalBudgetMs: number
    maxRetries: number
  }
): Promise<FetchTextResult> {
  let lastError = 'Fetch failed'

  for (let attempt = 0; attempt <= context.maxRetries; attempt += 1) {
    if (isBudgetExpired(context.startedAt, context.now, context.totalBudgetMs)) return { status: 'timeout' }

    await waitForDomainRateLimit(url.hostname, context.now, context.sleep)
    const result = await fetchTextOnce(url, context)

    if (result.status === 'ok' || result.status === 'not_found' || result.status === 'rate_limited' || result.status === 'timeout') {
      return result
    }

    lastError = result.error
    if (attempt >= context.maxRetries) break

    const backoff = TRANSIENT_BACKOFF_MS[Math.min(attempt, TRANSIENT_BACKOFF_MS.length - 1)]
    if (context.now() - context.startedAt + backoff > context.totalBudgetMs) return { status: 'timeout' }
    await context.sleep(backoff)
  }

  return { status: 'failed', error: lastError }
}

async function fetchTextOnce(
  url: URL,
  context: Required<Pick<ExtractVenueContactsOptions, 'now' | 'sleep' | 'fetchImpl'>> & {
    startedAt: number
    requestTimeoutMs: number
    totalBudgetMs: number
    maxRetries: number
  }
): Promise<FetchTextResult> {
  const remainingBudget = Math.max(1, context.totalBudgetMs - (context.now() - context.startedAt))
  const timeoutMs = Math.min(context.requestTimeoutMs, remainingBudget)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await context.fetchImpl(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': VENUE_WEBSITE_EXTRACTOR_USER_AGENT,
        Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
      },
    })

    if (response.status === 429) return { status: 'rate_limited' }
    if (response.status === 404) return { status: 'not_found' }
    if (response.status >= 500) return { status: 'failed', error: `HTTP ${response.status}` }
    if (!response.ok) return { status: 'failed', error: `HTTP ${response.status}` }

    return { status: 'ok', text: await response.text() }
  } catch (error) {
    if (controller.signal.aborted || isBudgetExpired(context.startedAt, context.now, context.totalBudgetMs)) {
      return { status: 'timeout' }
    }
    return { status: 'failed', error: error instanceof Error ? error.message : 'Network error' }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForDomainRateLimit(hostname: string, now: () => number, sleep: SleepLike) {
  const previousQueue = domainQueues.get(hostname) ?? Promise.resolve()
  const nextQueue = previousQueue.then(async () => {
    const lastRequestAt = domainLastRequestAt.get(hostname)
    if (typeof lastRequestAt === 'number') {
      const waitMs = Math.max(0, RATE_LIMIT_INTERVAL_MS - (now() - lastRequestAt))
      if (waitMs > 0) await sleep(waitMs)
    }
    domainLastRequestAt.set(hostname, now())
  })

  domainQueues.set(hostname, nextQueue.catch(() => undefined))
  await nextQueue
}

function isBudgetExpired(startedAt: number, now: () => number, totalBudgetMs: number) {
  return now() - startedAt >= totalBudgetMs
}

function shouldSkipEmail(email: string): boolean {
  const [localPart = '', domain = ''] = email.toLowerCase().split('@')
  const junkLocalParts = ['example', 'test', 'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'webmaster']
  const junkDomains = ['sentry.io', 'example.com', 'yourdomain.com']

  return (
    junkLocalParts.some((prefix) => localPart === prefix || localPart.startsWith(`${prefix}+`)) ||
    junkDomains.includes(domain)
  )
}

function getSurroundingContext(decodedHtml: string, startIndex: number, emailLength: number) {
  return decodedHtml
    .slice(Math.max(0, startIndex - 120), startIndex + emailLength + 120)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function addContactFormCandidate(
  candidates: Map<string, Omit<ExtractedContactForm, 'extracted_at'>>,
  candidate: Omit<ExtractedContactForm, 'extracted_at'>
) {
  const key = candidate.url.toLowerCase()
  const existing = candidates.get(key)
  if (!existing || candidate.confidence > existing.confidence) {
    candidates.set(key, candidate)
  }
}

function readHtmlAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  const match = tag.match(pattern)
  const value = match?.[2]?.trim()
  return value || null
}

function toAbsoluteContactUrl(value: string | null | undefined, pageUrl: URL): string | null {
  const trimmed = value?.trim()
  if (!trimmed || /^mailto:|^tel:|^javascript:/i.test(trimmed)) return null
  try {
    const url = new URL(trimmed, pageUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

function pickContactFormLabel(values: Array<string | null | undefined>, fallback: string): string {
  const meaningful = values
    .map((value) => value?.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .find((value) => value && /contact|event|private|book|reserv|cater|inquir|request|quote/i.test(value))
  if (!meaningful) return fallback
  return meaningful.length > 72 ? `${meaningful.slice(0, 69).trim()}...` : meaningful
}

function scoreContactFormConfidence(value: string, sourcePath: string): number {
  const text = `${value} ${sourcePath}`.toLowerCase()
  let confidence = 0.35
  if (/\b(private[-\s]?events?|events?|booking|book|inquir(?:y|ies)|request|quote|cater(?:ing)?|reservation)\b/.test(text)) confidence += 0.35
  if (/\b(contact|contact-us|host|rentals?)\b/.test(text)) confidence += 0.15
  if (isPathMatch(sourcePath.toLowerCase(), ['/events', '/private-events', '/book', '/booking', '/inquiries', '/contact', '/contact-us'])) confidence += 0.1
  if (/\bnewsletter|subscribe|login|sign[-\s]?in|search|comment|review\b/.test(text)) confidence -= 0.25
  return Math.min(1, Math.max(0, Number(confidence.toFixed(2))))
}

function isNonBookingForm(value: string) {
  return /\b(newsletter|subscribe|login|sign[-\s]?in|search|comment|review)\b/i.test(value)
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function isPathMatch(path: string, expectedPaths: string[]) {
  return expectedPaths.some((expectedPath) => path === expectedPath || path.startsWith(`${expectedPath}/`))
}

function markLikelyBookingContact(emails: ExtractedEmail[], disambiguation: ContactDisambiguationResult) {
  const ranked = [...disambiguation.ranked_emails].sort(
    (a, b) => b.likelihood_booking_contact - a.likelihood_booking_contact
  )
  const likelyEmail = ranked[0]?.email.toLowerCase()
  if (!likelyEmail) {
    markHighestConfidenceEmail(emails)
    return
  }

  for (const email of emails) {
    email.is_likely_booking_contact = email.email.toLowerCase() === likelyEmail
  }
}

function markHighestConfidenceEmail(emails: ExtractedEmail[]) {
  const likelyEmail = [...emails].sort((a, b) => b.confidence - a.confidence || a.email.localeCompare(b.email))[0]?.email
  for (const email of emails) {
    email.is_likely_booking_contact = email.email === likelyEmail
  }
}

function getMatchingRobotsGroups(groups: RobotsGroup[], userAgent: string) {
  const userAgentTokens = getUserAgentTokens(userAgent)
  const exactGroups = groups.filter((group) => (
    group.agents.some((agent) => agent !== '*' && userAgentTokens.some((token) => token.startsWith(agent)))
  ))
  if (exactGroups.length > 0) return exactGroups
  return groups.filter((group) => group.agents.includes('*'))
}

function getUserAgentTokens(userAgent: string) {
  const lower = userAgent.toLowerCase()
  const productToken = lower.split(/[ /\t]/)[0] ?? lower
  return [lower, productToken]
}

function robotsRuleMatchesPath(rulePath: string, path: string) {
  if (!rulePath) return false
  if (!rulePath.includes('*') && !rulePath.endsWith('$')) return path.startsWith(rulePath)

  const mustEnd = rulePath.endsWith('$')
  const pattern = rulePath.replace(/\$$/, '')
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*')
  const regex = new RegExp(`^${escaped}${mustEnd ? '$' : ''}`)
  return regex.test(path)
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
