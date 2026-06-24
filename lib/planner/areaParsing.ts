export type AreaAliasMap = Map<string, string>

type AreaDefinition = {
  id: string
  aliases: string[]
}

const AREA_DEFINITIONS: AreaDefinition[] = [
  { id: 'sf', aliases: ['sf', 'san francisco', 'the city'] },
  { id: 'soma', aliases: ['soma', 'south of market'] },
  { id: 'mission', aliases: ['mission', 'mission district'] },
  { id: 'hayes_valley', aliases: ['hayes valley', 'hayes'] },
  { id: 'castro', aliases: ['castro'] },
  { id: 'marina', aliases: ['marina'] },
  { id: 'north_beach', aliases: ['north beach'] },
  { id: 'fillmore', aliases: ['fillmore'] },
  { id: 'downtown_sf', aliases: ['downtown sf', 'downtown san francisco'] },
  { id: 'oakland', aliases: ['oakland'] },
  { id: 'downtown_oakland', aliases: ['downtown oakland'] },
  { id: 'uptown_oakland', aliases: ['uptown oakland'] },
  { id: 'east_oakland', aliases: ['east oakland'] },
  { id: 'jack_london', aliases: ['jack london square', 'jack london'] },
  { id: 'berkeley', aliases: ['berkeley', 'downtown berkeley', 'berkeley downtown'] },
  { id: 'emeryville', aliases: ['emeryville'] },
  { id: 'alameda', aliases: ['alameda'] },
  { id: 'san_jose', aliases: ['san jose'] },
  { id: 'palo_alto', aliases: ['palo alto'] },
  { id: 'mountain_view', aliases: ['mountain view'] },
  { id: 'redwood_city', aliases: ['redwood city'] },
  { id: 'san_mateo', aliases: ['san mateo'] },
  { id: 'sausalito', aliases: ['sausalito'] },
]

const DEFAULT_ALIAS_MAP: AreaAliasMap = AREA_DEFINITIONS.reduce((map, area) => {
  map.set(area.id, area.id)
  area.aliases.forEach((alias) => map.set(normalizeAreaText(alias), area.id))
  return map
}, new Map<string, string>())

const DIRECTIONAL_PREFIXES = new Set([
  'downtown',
  'uptown',
  'north',
  'south',
  'east',
  'west',
  'north beach',
])

const CITY_SUFFIXES = ['oakland', 'san francisco', 'sf', 'berkeley', 'alameda']

export function parseNeighborhoodPhrase(phrase: string | null | undefined, aliasMap = DEFAULT_ALIAS_MAP): string[] {
  const normalized = normalizeAreaText(phrase ?? '')
  if (!normalized) return []

  const direct = aliasMap.get(normalized)
  if (direct) return [direct]

  const inferredCity = inferSharedCitySuffix(normalized)
  const fragments = normalized
    .split(/\s*(?:,|\/|\bor\b|\band\b)\s*/i)
    .map((fragment) => normalizeAreaText(fragment))
    .filter(Boolean)

  const resolved = fragments.flatMap((fragment) => {
    const candidates = buildFragmentCandidates(fragment, inferredCity)
    for (const candidate of candidates) {
      const areaId = aliasMap.get(candidate)
      if (areaId) return [areaId]
    }
    return []
  })

  return [...new Set(resolved)]
}

export function buildDefaultAreaAliasMap(): AreaAliasMap {
  return new Map(DEFAULT_ALIAS_MAP)
}

export function areaAliasesForIds(areaIds: string[], aliasMap = DEFAULT_ALIAS_MAP): string[] {
  const aliases: string[] = []
  for (const areaId of areaIds) {
    aliases.push(areaId.replace(/_/g, ' '))
    for (const [alias, id] of aliasMap.entries()) {
      if (id === areaId) aliases.push(alias.replace(/_/g, ' '))
    }
  }
  return [...new Set(aliases)]
}

function buildFragmentCandidates(fragment: string, inferredCity: string | null): string[] {
  const candidates = [fragment]
  if (inferredCity && DIRECTIONAL_PREFIXES.has(fragment)) {
    candidates.unshift(`${fragment} ${inferredCity}`)
  }
  if (fragment === 'downtown' && !inferredCity) {
    candidates.push('downtown sf', 'downtown san francisco')
  }
  return candidates
}

function inferSharedCitySuffix(value: string): string | null {
  return CITY_SUFFIXES.find((city) => new RegExp(`\\b${escapeRegExp(city)}\\b`).test(value)) ?? null
}

function normalizeAreaText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s/,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
