/**
 * Parses the user's message for explicit decline / preference phrases and maps
 * them onto `matching_signals` so the vendor stack builder (recommendVendorStack.ts)
 * can honor them. Without this, organizer statements like "BYOB ok" or "no
 * photographer needed" never reach the structured signal layer and the system
 * recommends services the user already declined.
 *
 * Patterns are intentionally conservative — they fire on clear declines, not
 * ambiguous phrasing. The intake agent + archetype questions still handle the
 * affirmative path.
 */
const DECLINE_PATTERNS: Array<{ field: string; value: string | boolean; pattern: RegExp }> = [
  // Photo/video — explicit declines
  { field: 'photo_video_priority', value: 'none', pattern: /\b(no|don'?t need|do not need|skip|without)\s+(a\s+)?(photographer|photography|photo|videographer|video|photo\/video|photo & video)\b/i },
  { field: 'photo_video_priority', value: 'none', pattern: /\b(photo|photography|photographer|video|videographer)\s+not\s+(needed|required)\b/i },

  // Music / DJ — explicit declines
  { field: 'music_format', value: 'none', pattern: /\b(no|don'?t need|do not need|skip|without)\s+(a\s+)?(dj|music|live music|live band|band)\b/i },
  { field: 'music_format', value: 'none', pattern: /\b(dj|music|live music)\s+not\s+(needed|required)\b/i },

  // Bar — BYOB / no bar
  { field: 'bar_required', value: false, pattern: /\b(byob|bring your own (bottle|beer|booze|drinks?))\b/i },
  { field: 'bar_required', value: false, pattern: /\b(no|don'?t need|do not need|skip|without)\s+(a\s+)?(bar|bartender|bar service|bartending)\b/i },
  { field: 'bar_required', value: false, pattern: /\b(bar|bartender)\s+not\s+(needed|required)\b/i },

  // Security
  { field: 'security_needs', value: 'none', pattern: /\b(no|don'?t need|do not need|skip|without)\s+(security|bouncer|door staff)\b/i },

  // Decor
  { field: 'decor_intensity', value: 'none', pattern: /\b(no|don'?t need|do not need|skip|without)\s+(decor|decorations?|production decor)\b/i },

  // Catering — explicit decline
  { field: 'catering_style', value: 'self', pattern: /\b(no catering|don'?t need catering|do not need catering|skip catering|without catering)\b/i },
]

export function extractUserPreferenceSignals(message: string): Record<string, string | boolean> {
  const signals: Record<string, string | boolean> = {}
  if (!message || typeof message !== 'string') return signals

  for (const { field, value, pattern } of DECLINE_PATTERNS) {
    if (signals[field] !== undefined) continue
    if (pattern.test(message)) signals[field] = value
  }
  return signals
}

/**
 * Merges newly-extracted decline signals into existing plan metadata, treating
 * user-stated values as authoritative — they override archetype default fills.
 */
export function mergeUserPreferenceSignalsIntoMetadata(
  existingMetadata: Record<string, unknown> | null,
  message: string
): Record<string, unknown> | null {
  const newSignals = extractUserPreferenceSignals(message)
  if (Object.keys(newSignals).length === 0) return null

  const base = { ...(existingMetadata ?? {}) }
  const existingSignals = base.matching_signals && typeof base.matching_signals === 'object' && !Array.isArray(base.matching_signals)
    ? { ...(base.matching_signals as Record<string, unknown>) }
    : {}

  for (const [field, value] of Object.entries(newSignals)) {
    existingSignals[field] = value
  }

  base.matching_signals = existingSignals
  return base
}
