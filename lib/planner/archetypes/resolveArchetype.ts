import { ARCHETYPES, DEFAULT_ARCHETYPE } from '@/lib/planner/archetypes/data'
import type { EventArchetypeConfig, VendorStackItem, CommercialModel } from '@/lib/planner/archetypes/types'

type AliasMatch = {
  key: string
  alias: string
  score: number
  match_strength: ArchetypeMatchStrength
}

export type ArchetypeMatchStrength = 'exact' | 'fuzzy' | 'inferred'

export type ResolvedArchetypeAlternative = {
  key: string
  display_name: string
  why: string
}

export type ResolvedArchetypeMatch = {
  key: string
  display_name: string
  match_strength: ArchetypeMatchStrength
  matched_alias: string | null
  alternative_archetypes: ResolvedArchetypeAlternative[]
}

export type ResolvedArchetypeContext = {
  key: string
  display_name: string
  match_strength: ArchetypeMatchStrength
  matched_alias: string | null
  alternative_archetypes: ResolvedArchetypeAlternative[]
  capacity_range: [number, number]
  vendor_stack: VendorStackItem[]
  preferred_commercial_models: CommercialModel[]
}

const INFERRED_ARCHETYPE_RULES: Array<{
  key: string
  pattern: RegExp
  matched_alias: string
}> = [
  {
    key: 'private_dinner_celebration',
    pattern: /\b(?:women'?s|ladies|girls|community|members?|supper\s+club)\s+(?:dinner|supper)\b|\b(?:dinner|supper)\s+(?:for|with)\s+(?:women|ladies|girls|members?)\b/i,
    matched_alias: 'inferred dinner gathering',
  },
]

const ALIAS_ENTRIES = ARCHETYPES.flatMap((archetype) => [
  { key: archetype.key, alias: archetype.display_name },
  { key: archetype.key, alias: archetype.key.replace(/_/g, ' ') },
  ...archetype.aliases.map((alias) => ({ key: archetype.key, alias })),
])

export function resolveArchetypeKey(rawText: string): string | null {
  return resolveArchetypeMatch(rawText)?.key ?? null
}

export function resolveArchetypeMatch(rawText: string): ResolvedArchetypeMatch | null {
  const normalized = normalizeText(rawText)
  if (!normalized) return null
  const normalizedWordCount = normalized.split(/\s+/).filter(Boolean).length

  const exact = ALIAS_ENTRIES.find((entry) => normalizeText(entry.alias) === normalized && !isNegatedAlias(normalized, entry.alias))
  if (exact) return buildResolvedMatch(exact.key, 'exact', exact.alias)

  const matches = ALIAS_ENTRIES
    .map((entry): AliasMatch | null => {
      const alias = normalizeText(entry.alias)
      if (!alias || alias.length < 4) return null
      if (isNegatedAlias(normalized, entry.alias)) return null
      const isExactPhrase = containsPhrase(normalized, alias)
      const isFuzzyPhrase = normalizedWordCount >= 2 && containsPhrase(alias, normalized)
      if (!isExactPhrase && !isFuzzyPhrase) return null

      return {
        key: entry.key,
        alias,
        match_strength: isExactPhrase ? 'exact' : 'fuzzy',
        score: alias.length + (isExactPhrase ? 1000 : 0),
      }
    })
    .filter((match): match is AliasMatch => match !== null)
    .sort((first, second) => second.score - first.score)

  const aliasMatch = matches[0]
  if (aliasMatch) return buildResolvedMatch(aliasMatch.key, aliasMatch.match_strength, aliasMatch.alias)

  const inferred = INFERRED_ARCHETYPE_RULES.find((rule) => {
    const archetype = getArchetypeByKey(rule.key)
    if (!archetype) return false
    const hasNegatedAlias = [
      archetype.display_name,
      archetype.key.replace(/_/g, ' '),
      ...archetype.aliases,
    ].some((alias) => isNegatedAlias(normalized, alias))
    return rule.pattern.test(rawText) && !hasNegatedAlias
  })
  if (inferred) return buildResolvedMatch(inferred.key, 'inferred', inferred.matched_alias)

  return null
}

export function archetypeFor(eventType: string | null): EventArchetypeConfig {
  const key = eventType ? resolveArchetypeKey(eventType) : null
  return ARCHETYPES.find((archetype) => archetype.key === key) ?? DEFAULT_ARCHETYPE
}

export function resolveArchetypeContext(rawText: string): ResolvedArchetypeContext | null {
  const match = resolveArchetypeMatch(rawText)
  const archetype = getArchetypeByKey(match?.key)
  if (!archetype) return null

  return {
    key: archetype.key,
    display_name: archetype.display_name,
    match_strength: match?.match_strength ?? 'exact',
    matched_alias: match?.matched_alias ?? null,
    alternative_archetypes: match?.alternative_archetypes ?? buildAlternativeArchetypes(archetype),
    capacity_range: archetype.capacity_range,
    vendor_stack: archetype.vendor_stack,
    preferred_commercial_models: archetype.preferred_commercial_models,
  }
}

export function getArchetypeByKey(key: string | null | undefined): EventArchetypeConfig | null {
  if (!key) return null
  return ARCHETYPES.find((archetype) => archetype.key === key) ?? null
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(text)
}

function buildResolvedMatch(
  key: string,
  matchStrength: ArchetypeMatchStrength,
  matchedAlias: string | null
): ResolvedArchetypeMatch | null {
  const archetype = getArchetypeByKey(key)
  if (!archetype) return null

  return {
    key: archetype.key,
    display_name: archetype.display_name,
    match_strength: matchStrength,
    matched_alias: matchedAlias,
    alternative_archetypes: buildAlternativeArchetypes(archetype),
  }
}

function buildAlternativeArchetypes(archetype: EventArchetypeConfig): ResolvedArchetypeAlternative[] {
  return archetype.adjacent_archetypes
    .map((key) => getArchetypeByKey(key))
    .filter((adjacent): adjacent is EventArchetypeConfig => adjacent !== null)
    .slice(0, 3)
    .map((adjacent) => ({
      key: adjacent.key,
      display_name: adjacent.display_name,
      why: `Use this if the event should feel more like ${adjacent.display_name.toLowerCase()}.`,
    }))
}

function isNegatedAlias(normalizedText: string, rawAlias: string): boolean {
  const alias = normalizeText(rawAlias)
  if (!alias) return false

  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(
    `\\b(?:not|not\\s+a|not\\s+an|is\\s+not|isnt|isn\\s+t|don\\s+t\\s+want|do\\s+not\\s+want|dont\\s+want|no)\\s+(?:\\w+\\s+){0,3}${escaped}\\b`,
    'i'
  ).test(normalizedText)
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bpanle\b/g, 'panel')
    .replace(/\bstatup\b/g, 'startup')
    .replace(/\bstratup\b/g, 'startup')
    .replace(/[_/-]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
