import type { Database } from '@/lib/types/database-generated'
import type { AvailabilityBlock } from '@/lib/types'

export type AvailabilityBlockRow = Database['public']['Tables']['availability_blocks']['Row']

type AvailabilityBlockInput = {
  venue_id?: string | null
  vendor_id?: string | null
  start_date: string
  end_date: string
  reason?: string | null
  notes?: string | null
}

export function normalizeAvailabilityBlock(row: AvailabilityBlockRow): AvailabilityBlock {
  return {
    ...row,
    venue_id: row.blockable_type === 'venue' ? row.blockable_id : null,
    vendor_id: row.blockable_type === 'vendor' ? row.blockable_id : null,
    start_time: null,
    end_time: null,
    is_available: false,
    reason: row.reason,
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  }
}

export function normalizeAvailabilityBlocks(rows: AvailabilityBlockRow[] | null | undefined) {
  return (rows || []).map(normalizeAvailabilityBlock)
}

export function toAvailabilityBlockInsert(block: AvailabilityBlockInput) {
  const blockableId = block.venue_id || block.vendor_id
  const blockableType = block.venue_id ? 'venue' : 'vendor'

  if (!blockableId) {
    throw new Error('A venue_id or vendor_id is required')
  }

  return {
    blockable_type: blockableType,
    blockable_id: blockableId,
    start_date: block.start_date.split('T')[0],
    end_date: block.end_date.split('T')[0],
    reason: block.reason || null,
    notes: block.notes || null,
  }
}

export function toAvailabilityBlockUpdate(updates: Partial<AvailabilityBlockInput>) {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (updates.start_date !== undefined) row.start_date = updates.start_date.split('T')[0]
  if (updates.end_date !== undefined) row.end_date = updates.end_date.split('T')[0]
  if (updates.reason !== undefined) row.reason = updates.reason
  if (updates.notes !== undefined) row.notes = updates.notes

  return row
}
