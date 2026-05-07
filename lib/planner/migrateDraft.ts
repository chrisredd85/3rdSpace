import type { PlannerCreatePlanResponse } from '@/lib/types'

export const plannerDraftStorageKey = 'planner-active-conversation'

interface StoredPlannerDraftMessage {
  role?: string
  content?: string
  message_type?: string
  metadata?: unknown
  created_at?: string
}

interface StoredPlannerDraft {
  plan?: Record<string, unknown>
  messages?: StoredPlannerDraftMessage[]
}

/**
 * Reads the anonymous planner draft buffer from localStorage.
 */
export function readStoredPlannerDraft(): StoredPlannerDraft | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(plannerDraftStorageKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as StoredPlannerDraft
    if (!parsed || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Clears the anonymous planner draft buffer after it has been persisted.
 */
export function clearStoredPlannerDraft() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(plannerDraftStorageKey)
}

/**
 * Migrates a local anonymous planner conversation into a server-backed plan.
 */
export async function migratePlannerDraftToServer(): Promise<PlannerCreatePlanResponse | null> {
  const draft = readStoredPlannerDraft()
  if (!draft) return null

  const message = getPlannerDraftInitialMessage(draft)
  if (!message) return null

  const response = await fetch('/api/planner/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message, draft }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.plan?.id) {
    throw new Error(payload?.error || 'Unable to migrate planner draft')
  }

  clearStoredPlannerDraft()
  return payload as PlannerCreatePlanResponse
}

function getPlannerDraftInitialMessage(draft: StoredPlannerDraft) {
  return draft.messages?.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim())
    ?.content
    ?.trim() ?? null
}
