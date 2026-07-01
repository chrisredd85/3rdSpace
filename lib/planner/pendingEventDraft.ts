import type { PlannerCreatePlanResponse } from '@/lib/types'

export const pendingEventDraftStorageKey = 'pending_event_draft'

const maxDraftAgeMs = 1000 * 60 * 60 * 24

export interface PendingEventDraft {
  prompt: string
  timestamp: number
  intent?: 'rebook'
}

export function storePendingEventDraft(draft: PendingEventDraft) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(pendingEventDraftStorageKey, JSON.stringify(draft))
}

export function readPendingEventDraft(): PendingEventDraft | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(pendingEventDraftStorageKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PendingEventDraft>
    if (!parsed || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) return null
    if (typeof parsed.timestamp !== 'number') return null
    if (Date.now() - parsed.timestamp > maxDraftAgeMs) {
      clearPendingEventDraft()
      return null
    }
    return {
      prompt: parsed.prompt.trim(),
      timestamp: parsed.timestamp,
      intent: parsed.intent === 'rebook' ? 'rebook' : undefined,
    }
  } catch {
    return null
  }
}

export function clearPendingEventDraft() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(pendingEventDraftStorageKey)
}

export async function migratePendingEventDraftToServer(): Promise<PlannerCreatePlanResponse | null> {
  const draft = readPendingEventDraft()
  if (!draft) return null

  const response = await fetch('/api/planner/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message: draft.prompt }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.plan?.id) {
    throw new Error(payload?.error || 'Unable to create planner draft')
  }

  clearPendingEventDraft()
  return payload as PlannerCreatePlanResponse
}
