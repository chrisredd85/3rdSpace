export function updatePlannerLivePlanPayload(plan: unknown) {
  if (typeof window === 'undefined' || !plan || typeof plan !== 'object') return

  try {
    const raw = window.localStorage.getItem('planner-live-plan')
    const current = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    const next = {
      ...current,
      plan: {
        ...(typeof current.plan === 'object' && current.plan !== null ? current.plan as Record<string, unknown> : {}),
        ...(plan as Record<string, unknown>),
      },
    }
    window.localStorage.setItem('planner-live-plan', JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: next }))
  } catch {
    window.dispatchEvent(new CustomEvent('planner-live-plan:update'))
  }
}
