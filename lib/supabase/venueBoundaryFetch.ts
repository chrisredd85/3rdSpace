import { assertDurableVendorContent, VendorPersistenceError } from '@/lib/discovery/vendorPersistence'
import { readSafeDiscoveryVendor } from '@/lib/discovery/vendorRepository'
import { readDiscoveryRpcResponse, committedResponseUnavailable } from './discoveryRpcResponse'
import { assertDurableVenueContent, readSafeVenueSnapshot, VenuePersistenceError } from '@/lib/discovery/venuePersistence'
import { readLegacyVenueContent, versionVenueContentWrite } from '@/lib/discovery/venueLegacyReads'
import { NonDurableDiscoveryContentError } from '@/lib/discovery/foundation/boundary'

const immutableTables = new Set(['approvals', 'agent_actions', 'venue_bookings', 'vendor_bookings'])

/** All active copies of venue content cross this transport, including RPC arguments.
 * SQL separately fences stale binaries, direct clients, and definer-generated writes.
 * This boundary is unconditional; the acquisition flag is deliberately absent.
 */
export const VENUE_COPY_TABLES = new Set([
  'discovery_venues', 'discovery_venues_safe', 'plan_discovery_venue_candidates',
  'discovery_vendors', 'discovery_vendors_safe', 'plan_discovery_vendor_candidates', 'vendor_bookings',
  'discovery_field_changes', 'discovery_change_log', 'recommendations', 'plan_messages', 'plans', 'plan_versions', 'plan_revisions',
  'agent_actions', 'approvals', 'venue_bookings', 'admin_tasks', 'admin_audit_log', 'audit_logs',
  'templates', 'outreach_drafts', 'outreach_threads', 'outreach_messages', 'agent_runs', 'app_jobs',
  'supply_scout_venue_leads', 'event_templates', 'notifications', 'agent_action_audit_log',
  'template_runs', 'outreach_notifications', 'discovery_venue_events',
  'venue_opportunity_briefs', 'venue_opportunity_invites',
])
export function venueBoundaryFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const resource = url.pathname.match(/\/rest\/v1\/([^/]+)/)?.[1]
    const rpc = resource === 'rpc' ? url.pathname.split('/').pop() ?? '' : null
    const vendorSource = resource === 'discovery_vendors' || resource === 'discovery_vendors_safe'
      || rpc === 'upsert_discovery_vendor_identity' || rpc === 'write_discovery_vendor_independent_facts'
    const affected = Boolean(resource && (VENUE_COPY_TABLES.has(resource) || resource === 'rpc'))
    if (!affected) return fetchImpl(input, init)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let requestInit = init
    let rpcArgs: unknown = null
    if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : null)
      if (typeof body === 'string' && body) {
        try {
          const data: unknown = JSON.parse(body)
          if (rpc) rpcArgs = data
          assertDurableVenueContent(data)
          assertDurableVendorContent(data)
          // Stamp only new table content after validation, never RPC arguments or old reads.
          const versioned = resource === 'rpc' ? data : versionVenueContentWrite(resource, data)
          if (versioned !== data) requestInit = { ...init, body: JSON.stringify(versioned) }
        } catch (error) {
          if (error instanceof SyntaxError) throw new VenuePersistenceError('request_json')
          throw error
        }
      }
    }
    const response = await fetchImpl(input, { ...requestInit, cache: 'no-store' })
    if (!response.headers.get('content-type')?.includes('json') || method === 'HEAD' || response.status === 204 || response.status === 205) return response
    const data: unknown = await response.json()
    const headers = new Headers(response.headers)
    headers.delete('content-length'); headers.delete('etag')
    headers.set('Cache-Control', 'private, no-store, max-age=0')
    headers.set('CDN-Cache-Control', 'no-store'); headers.set('Vercel-CDN-Cache-Control', 'no-store')
    // Immutable approval/action snapshots must never be silently rewritten, which would change their hash.
    const immutable = resource === 'rpc' || Boolean(resource && immutableTables.has(resource))
    let safe: unknown
    // Isolate only list reads. A targeted single-record lookup, write response,
    // or RPC must still reject the affected signed record without alteration.
    const isolateList = response.ok && method === 'GET' && Array.isArray(data)
      && !url.searchParams.get('id')?.startsWith('eq.')
      && (resource === 'plan_messages' || Boolean(resource && immutableTables.has(resource)))
    if (isolateList && Array.isArray(data)) {
      let unavailable = 0
      safe = data.flatMap(row => {
        try {
          if (immutable) { assertDurableVenueContent(row); assertDurableVendorContent(row); return [row] }
          return [readLegacyVenueContent(resource, readSafeVenueSnapshot(row))]
        } catch (error) {
          if (!(error instanceof VenuePersistenceError || error instanceof VendorPersistenceError || error instanceof NonDurableDiscoveryContentError)) throw error
          unavailable += 1
          return resource === 'plan_messages' ? [unavailableMessage(row)] : []
        }
      })
      headers.set('X-3rdPlace-Unavailable-Records', String(unavailable))
    } else if (!response.ok) {
      safe = safeError(data)
    } else if (vendorSource) {
      // The safe view has already projected selected columns. Full identity/fact
      // RPC rows also receive the compatible reader; no raw-name fallback.
      const read = (row: unknown) => row && typeof row === 'object' && 'id' in row
        ? readSafeDiscoveryVendor(row) : row
      safe = Array.isArray(data) ? data.map(read) : read(data)
    } else if (rpc) {
      try { safe = readDiscoveryRpcResponse(rpc, data, rpcArgs) } catch (error) {
        if (method === 'GET' || method === 'HEAD') throw error
        // A successful POST committed. A read-validation error must not be
        // represented as a failed SQL transaction or cause an automatic retry.
        return new Response(JSON.stringify(committedResponseUnavailable()), { status: 409, headers })
      }
    } else {
      if (immutable) { assertDurableVenueContent(data); assertDurableVendorContent(data) }
      safe = immutable ? data : readLegacyVenueContent(resource, readSafeVenueSnapshot(data))
    }
    return new Response(JSON.stringify(safe), { status: response.status, statusText: response.statusText, headers })
  }
}
function unavailableMessage(value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const identity = Object.fromEntries(['id', 'plan_id', 'created_at', 'updated_at'].flatMap(key =>
    typeof row[key] === 'string' ? [[key, row[key]]] : []))
  return {
    ...identity,
    role: ['user', 'agent', 'system'].includes(String(row.role)) ? row.role : 'system',
    content: 'Earlier generated content is unavailable pending source verification.',
    message_type: 'status_update',
    metadata: { venue_content_unavailable: true, reason: 'source_verification_required' },
  }
}
function safeError(value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const stageConflict = row.code === '23514' && (row.message === 'vendor_boundary_stage_fact_changed' || row.message === 'vendor_boundary_stage_snapshot_mismatch')
  return { code: typeof row.code === 'string' ? row.code : 'DATABASE_ERROR', message: stageConflict ? row.message : 'Database request failed', details: null, hint: null }
}
