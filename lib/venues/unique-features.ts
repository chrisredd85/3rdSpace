const TAG_KEYWORDS: Record<string, string[]> = {
  historic: ['historic', 'historical', 'heritage', 'landmark', 'original'],
  modern: ['modern', 'contemporary', 'sleek', 'minimal', 'newly renovated'],
  industrial: ['industrial', 'warehouse', 'loft', 'brick', 'exposed beams', 'concrete'],
  rooftop: ['rooftop', 'roof deck', 'terrace'],
  outdoor: ['outdoor', 'patio', 'garden', 'courtyard', 'open air'],
  waterfront: ['waterfront', 'waterside', 'harbor', 'bay view', 'water view'],
  'natural light': ['natural light', 'floor-to-ceiling windows', 'skylight', 'sunlit'],
  views: ['skyline view', 'city view', 'panoramic', 'scenic', 'views'],
  'sound system': ['sound system', 'audio', 'speakers', 'pa system'],
  'lighting rig': ['lighting rig', 'stage lights', 'led lighting', 'lighting'],
  'av equipment': ['projector', 'screen', 'screens', 'av', 'a/v'],
  parking: ['parking', 'garage', 'valet'],
  transit: ['bart', 'metro', 'subway', 'public transit', 'walking distance'],
  accessible: ['wheelchair accessible', 'ada compliant', 'accessible'],
  intimate: ['intimate', 'cozy', 'small'],
  spacious: ['spacious', 'large', 'open floor plan', 'wide open'],
  'full bar': ['full bar', 'bar service', 'liquor license'],
  kitchen: ['kitchen', 'catering kitchen', 'prep kitchen'],
  'green room': ['green room', 'dressing room'],
  'dance floor': ['dance floor', 'hardwood floors'],
}

/**
 * Extracts searchable tags from a venue's unique features text.
 *
 * @param text - Freeform venue features description.
 * @returns Deduplicated feature tags.
 */
export function extractUniqueFeatureTags(text: string): string[] {
  if (!text.trim()) return []

  const lowerText = text.toLowerCase()
  const tags = Object.entries(TAG_KEYWORDS)
    .filter(([, patterns]) => patterns.some((pattern) => lowerText.includes(pattern)))
    .map(([tag]) => tag)

  return Array.from(new Set(tags))
}

/**
 * Returns all supported unique-feature tags for filters and suggestions.
 *
 * @returns Sorted unique feature tag labels.
 */
export function getUniqueFeatureTagOptions(): string[] {
  return Object.keys(TAG_KEYWORDS).sort()
}
