import { discoveryFieldSchemas, type DiscoveryKind, type DiscoveryValue } from './fields'
import { asRecord, readFieldProvenance, type FieldProvenance } from './provenance'
import { readDiscoveryFields } from './reader'

export type DiscoveryIdentity = { kind: DiscoveryKind; id: string; place_id: string | null }

/** Not an ORM row or a persistence payload. Google content stays in the active request. */
export type TransientDiscovery = {
  readonly identity: DiscoveryIdentity
  readonly values: unknown
  readonly field_provenance: unknown
  readonly googleLive: unknown
  toJSON(): never
}

/** Own a frozen JSON-like snapshot so later caller mutation cannot detach values from evidence. */
function snapshot(value: unknown, seen = new WeakMap<object, unknown>(), depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value
  if (depth > 64) throw new Error('Discovery snapshot exceeds supported nesting')
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    for (const item of value) result.push(snapshot(item, seen, depth + 1))
    return Object.freeze(result)
  }
  const result: Record<string, unknown> = Object.create(null)
  seen.set(value, result)
  for (const [key, item] of Object.entries(value)) result[key] = snapshot(item, seen, depth + 1)
  return Object.freeze(result)
}

export function createTransientDiscovery(input: {
  identity: DiscoveryIdentity
  values?: unknown
  field_provenance?: unknown
  googleLive?: unknown
}): TransientDiscovery {
  return Object.freeze({
    identity: Object.freeze({ kind: input.identity.kind, id: input.identity.id, place_id: input.identity.place_id }),
    values: snapshot(input.values ?? {}),
    field_provenance: snapshot(input.field_provenance ?? {}),
    googleLive: snapshot(input.googleLive ?? null),
    toJSON(): never {
      throw new Error('Transient discovery content requires an explicit durable serializer')
    },
  })
}

export type DurableDiscovery = {
  schema_version: 1
  identity: DiscoveryIdentity
  values: Record<string, DiscoveryValue>
  field_provenance: Record<string, FieldProvenance>
}

export class NonDurableDiscoveryContentError extends Error {
  constructor(readonly fields: readonly string[]) {
    // Error contains field identifiers only; never copy provider content into logs.
    super(`Non-durable discovery fields: ${fields.join(', ')}`)
    this.name = 'NonDurableDiscoveryContentError'
  }
}

/**
 * ISOLATED ONLY: unused by all live writers. This allowlist serializes a specific
 * discovery contract, not arbitrary messages/JSON. Later gates must adapt each sink.
 * Evidence labels must come from trusted acquisition paths; this is not proof that
 * caller-supplied provenance is truthful or permission to relabel Google facts.
 */
export function serializeDiscovery(
  input: TransientDiscovery,
  mode: 'reject' | 'strip' = 'reject',
): DurableDiscovery {
  const identity = input.identity
  if (
    !identity || (identity.kind !== 'venue' && identity.kind !== 'vendor') ||
    typeof identity.id !== 'string' || !identity.id.trim() ||
    (identity.place_id !== null && (typeof identity.place_id !== 'string' || !identity.place_id.trim()))
  ) throw new Error('Invalid discovery identity')

  const row = asRecord(input.values) ?? {}
  const evidence = asRecord(input.field_provenance) ?? {}
  const states = readDiscoveryFields(identity.kind, row, evidence)
  const values: Record<string, DiscoveryValue> = {}
  const field_provenance: Record<string, FieldProvenance> = {}
  const rejected: string[] = input.googleLive == null ? [] : ['googleLive']
  for (const field of Object.keys(row)) {
    if (!Object.prototype.hasOwnProperty.call(discoveryFieldSchemas[identity.kind], field)) {
      rejected.push('[unrecognized field]')
      continue
    }
    const state = states[field]
    if (state.status === 'available') {
      values[field] = state.value
      field_provenance[field] = readFieldProvenance(evidence[field])
    } else if (row[field] !== null && row[field] !== undefined) rejected.push(field)
  }
  if (mode === 'reject' && rejected.length) throw new NonDurableDiscoveryContentError(rejected)
  return {
    schema_version: 1,
    identity: { kind: identity.kind, id: identity.id, place_id: identity.place_id },
    values,
    field_provenance,
  }
}
