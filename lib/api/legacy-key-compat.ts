import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

export type LegacyKeyMap = Record<string, string>

export type LegacyKeyContext = {
  route: string
  direction: 'request' | 'response'
}

function hasOwnKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function recordLegacyKeyUsage(context: LegacyKeyContext, key: string) {
  Sentry.addBreadcrumb({
    category: 'api.compat',
    message: 'legacy_key_used',
    level: 'info',
    data: {
      action: 'legacy_key_used',
      route: context.route,
      direction: context.direction,
      key,
    },
  })
}

export function normalizeLegacyKeys<T extends Record<string, unknown>>(
  input: T,
  legacyMap: LegacyKeyMap,
  context: LegacyKeyContext
): T {
  const normalized: Record<string, unknown> = { ...input }

  for (const [legacyKey, canonicalKey] of Object.entries(legacyMap)) {
    if (!hasOwnKey(input, legacyKey)) continue
    recordLegacyKeyUsage(context, legacyKey)

    if (!hasOwnKey(input, canonicalKey) || normalized[canonicalKey] === undefined) {
      normalized[canonicalKey] = input[legacyKey]
    }
  }

  return normalized as T
}

export function withLegacyResponseKeys<T extends Record<string, unknown>>(
  input: T,
  legacyMap: LegacyKeyMap,
  context: LegacyKeyContext
): T {
  const output: Record<string, unknown> = { ...input }

  for (const [legacyKey, canonicalKey] of Object.entries(legacyMap)) {
    if (hasOwnKey(output, canonicalKey) && !hasOwnKey(output, legacyKey)) {
      output[legacyKey] = output[canonicalKey]
    } else if (hasOwnKey(output, legacyKey) && !hasOwnKey(output, canonicalKey)) {
      output[canonicalKey] = output[legacyKey]
      recordLegacyKeyUsage(context, legacyKey)
    }
  }

  return output as T
}

export function jsonWithDeprecatedKeys<T>(
  body: T,
  deprecatedKeys: string[],
  init: ResponseInit = {}
) {
  const headers = new Headers(init.headers)
  if (deprecatedKeys.length > 0) {
    headers.set('X-Deprecated-Keys', Array.from(new Set(deprecatedKeys)).join(','))
  }

  return NextResponse.json(body, {
    ...init,
    headers,
  })
}
