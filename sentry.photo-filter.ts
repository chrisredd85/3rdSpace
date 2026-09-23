import type { Options, SpanJSON } from '@sentry/core'
import { containsGooglePhotoData } from './lib/discovery/googlePhotoPersistence'

function hasPhotoData(value: unknown): boolean {
  try {
    // Media URLs can use opaque paths (not only /places/ or /p/). This broader
    // telemetry-only rule also covers automatic fetch spans for such responses.
    return containsGooglePhotoData(value)
      || /(?:https?:\/\/|https?%3a%2f%2f)(?:[a-z0-9-]+\.)*googleusercontent\.com(?:\/|%2f)/i.test(JSON.stringify(value))
  } catch {
    // Uninspectable telemetry must not bypass the photo boundary.
    return true
  }
}

export function dropGooglePhotoTelemetry<T>(value: T): T | null {
  return hasPhotoData(value) ? null : value
}

function redactPhotoSpan(span: SpanJSON): SpanJSON {
  if (!hasPhotoData(span)) return span

  // Sentry's child-span hook cannot return null. Preserve correlation/timing only;
  // automatic fetch span descriptions and attributes can contain upstream tokens.
  return {
    span_id: span.span_id,
    trace_id: span.trace_id,
    parent_span_id: span.parent_span_id,
    start_timestamp: span.start_timestamp,
    timestamp: span.timestamp,
    description: '[Google photo omitted]',
    data: {},
  }
}

export const sentryPhotoPrivacyOptions = {
  beforeSend: dropGooglePhotoTelemetry,
  beforeBreadcrumb: dropGooglePhotoTelemetry,
  beforeSendLog: dropGooglePhotoTelemetry,
  beforeSendSpan: redactPhotoSpan,
  beforeSendTransaction(event) {
    const filtered = {
      ...event,
      spans: event.spans?.filter((span) => !hasPhotoData(span)),
      breadcrumbs: event.breadcrumbs?.filter((breadcrumb) => !hasPhotoData(breadcrumb)),
    }
    return dropGooglePhotoTelemetry(filtered)
  },
} satisfies Pick<Options, 'beforeSend' | 'beforeBreadcrumb' | 'beforeSendLog' | 'beforeSendSpan' | 'beforeSendTransaction'>
