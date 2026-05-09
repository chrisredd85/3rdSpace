import { ARCHETYPES, DEFAULT_ARCHETYPE } from '@/lib/planner/archetypes/data'
import type { EventArchetypeConfig, VendorStackItem, CommercialModel } from '@/lib/planner/archetypes/types'

type AliasMatch = {
  key: string
  alias: string
  score: number
}

export type ResolvedArchetypeContext = {
  key: string
  display_name: string
  capacity_range: [number, number]
  vendor_stack: VendorStackItem[]
  preferred_commercial_models: CommercialModel[]
}

const ALIAS_ENTRIES = ARCHETYPES.flatMap((archetype) => [
  { key: archetype.key, alias: archetype.display_name },
  { key: archetype.key, alias: archetype.key.replace(/_/g, ' ') },
  ...archetype.aliases.map((alias) => ({ key: archetype.key, alias })),
])

export function resolveArchetypeKey(rawText: string): string | null {
  const normalized = normalizeText(rawText)
  if (!normalized) return null

  const exact = ALIAS_ENTRIES.find((entry) => normalizeText(entry.alias) === normalized)
  if (exact) return exact.key

  const matches = ALIAS_ENTRIES
    .map((entry): AliasMatch | null => {
      const alias = normalizeText(entry.alias)
      if (!alias || alias.length < 4) return null
      if (!containsPhrase(normalized, alias) && !containsPhrase(alias, normalized)) return null

      return {
        key: entry.key,
        alias,
        score: alias.length,
      }
    })
    .filter((match): match is AliasMatch => match !== null)
    .sort((first, second) => second.score - first.score)

  return matches[0]?.key ?? null
}

export function archetypeFor(eventType: string | null): EventArchetypeConfig {
  const key = eventType ? resolveArchetypeKey(eventType) : null
  return ARCHETYPES.find((archetype) => archetype.key === key) ?? DEFAULT_ARCHETYPE
}

export function resolveArchetypeContext(rawText: string): ResolvedArchetypeContext | null {
  const key = resolveArchetypeKey(rawText)
  const archetype = getArchetypeByKey(key)
  if (!archetype) return null

  return {
    key: archetype.key,
    display_name: archetype.display_name,
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

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
