import type { PaymentApprovalRow } from '@/lib/planner/execution/paymentApproval'

export type PaymentExecutionAuditOutcome = 'succeeded' | 'failed' | 'refunded' | 'waived'

export async function writePaymentExecutionAudit(
  db: {
    from: (table: 'audit_logs') => {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error?: { message?: string } | null }>
    }
  },
  input: {
    approval: Pick<PaymentApprovalRow, 'id' | 'plan_id'>
    userId: string
    role: string
    action: string
    amountCents: number
    stripeObjectId: string | null
    outcome: PaymentExecutionAuditOutcome
    entityId?: string | null
    metadata?: Record<string, unknown>
  }
) {
  const { error } = await db.from('audit_logs').insert({
    user_id: input.userId,
    plan_id: input.approval.plan_id,
    action: input.action,
    entity_type: 'approval',
    entity_id: input.approval.id,
    before_state: null,
    after_state: {
      approval_id: input.approval.id,
      role: input.role,
      amount_cents: input.amountCents,
      stripe_object_id: input.stripeObjectId,
      outcome: input.outcome,
      entity_id: input.entityId ?? null,
      ...(input.metadata ?? {}),
    },
  })

  if (error) throw new Error(error.message ?? 'Failed to write payment execution audit log')
}
