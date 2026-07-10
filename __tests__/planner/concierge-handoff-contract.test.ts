import fs from 'node:fs'
import path from 'node:path'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('concierge handoff source contract', () => {
  it('does not create opportunity or catalog-gap admin tasks before approval', () => {
    const opportunityBuilder = read('lib/planner/opportunityBuilder.ts')
    const recommendRoute = read('app/api/planner/plans/[planId]/recommend/route.ts')

    expect(opportunityBuilder).not.toMatch(/from\(['"]admin_tasks['"]\)[\s\S]{0,80}\.insert/)
    expect(opportunityBuilder).not.toContain('createConciergeFallbackTask')
    expect(opportunityBuilder).toContain('concierge_invite_ids')
    expect(recommendRoute).not.toContain('insertCatalogGapAdminTask')
  })

  it('keeps approval CTA copy truthful before execution begins', () => {
    const conversation = read('components/planner/planner-page/PlannerConversation.tsx')
    const livePlan = read('components/planner/PlannerLivePlanPanel.tsx')

    expect(conversation).toContain('Approval created ✓')
    expect(conversation).toContain('review before the request is sent')
    expect(conversation).toContain('review before outreach begins')
    expect(conversation).not.toContain('Added to 3rdPlace team queue')
    expect(livePlan).toContain('Approval ready ✓')
  })

  it('does not mark concierge venue holds as Stripe-dependent', () => {
    const livePlan = read('components/planner/PlannerLivePlanPanel.tsx')
    const payloadBuilderStart = livePlan.indexOf('function buildLivePlanAgentActionPayload')
    const holdPayload = livePlan.slice(
      livePlan.indexOf("actionType: 'hold_request'", payloadBuilderStart),
      livePlan.indexOf('requestedAmountCents: card.amountCents', payloadBuilderStart)
    )

    expect(holdPayload).toContain("execution_mode: 'concierge_admin_queue'")
    expect(holdPayload).not.toContain('payment_required')
    expect(holdPayload).not.toContain('requires_stripe_recipient')
  })
})
