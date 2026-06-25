export type EntityReadinessStatus =
  | 'invited'
  | 'claimed_no_stripe'
  | 'claimed_stripe_pending'
  | 'claimed_stripe_restricted'
  | 'stripe_ready'
  | 'committed'
  | 'settled'

export type EntityReadinessIcon =
  | 'Clock'
  | 'AlertCircle'
  | 'AlertTriangle'
  | 'CheckCircle2'
  | 'ShieldCheck'

export type EntityReadinessTone = 'muted' | 'warning' | 'destructive' | 'success'

export type EntityReadinessIndicator = {
  status: EntityReadinessStatus
  label: string
  subtext: string | null
  icon: EntityReadinessIcon
  tone: EntityReadinessTone
}

export type EntityStripeReadinessInput = {
  is_claimed?: boolean | null
  isClaimed?: boolean | null
  claim_status?: string | null
  claimStatus?: string | null
  stripe_connect_status?: string | null
  stripeConnectStatus?: string | null
  stripe_account_status?: string | null
  stripeAccountStatus?: string | null
  account_status?: string | null
  accountStatus?: string | null
  invited_at?: string | null
  invitedAt?: string | null
  name?: string | null
}

export function resolveEntityReadiness(opts: {
  entityType: 'venue' | 'vendor'
  entity: EntityStripeReadinessInput | null | undefined
  committedAmount?: number | null
  committedAt?: string | null
  settledAmount?: number | null
  settledAt?: string | null
  nowMs?: number
}): EntityReadinessIndicator | null {
  const entity = opts.entity ?? {}
  const settledAt = normalizeDate(opts.settledAt)
  const committedAt = normalizeDate(opts.committedAt)
  const settledAmount = typeof opts.settledAmount === 'number' ? opts.settledAmount : opts.committedAmount
  const committedAmount = typeof opts.committedAmount === 'number' ? opts.committedAmount : null

  if (settledAt) {
    return {
      status: 'settled',
      label: `Settled · ${formatCents(settledAmount)}`,
      subtext: `Paid ${formatReadableDate(settledAt)}`,
      icon: 'ShieldCheck',
      tone: 'success',
    }
  }

  if (committedAmount !== null && committedAt) {
    return {
      status: 'committed',
      label: `Committed · ${formatCents(committedAmount)}`,
      subtext: `Quoted ${formatReadableDate(committedAt)}`,
      icon: 'ShieldCheck',
      tone: 'success',
    }
  }

  const normalizedStripeStatus = normalizeStripeStatus(
    entity.stripe_connect_status ??
      entity.stripeConnectStatus ??
      entity.stripe_account_status ??
      entity.stripeAccountStatus ??
      entity.account_status ??
      entity.accountStatus,
  )

  if (normalizedStripeStatus === 'restricted' || normalizedStripeStatus === 'disabled') {
    return {
      status: 'claimed_stripe_restricted',
      label: 'Stripe restricted',
      subtext: `Action required from ${entity.name ?? entityLabel(opts.entityType)}`,
      icon: 'AlertTriangle',
      tone: 'destructive',
    }
  }

  if (normalizedStripeStatus === 'pending') {
    return {
      status: 'claimed_stripe_pending',
      label: 'Stripe pending',
      subtext: 'Verification in progress',
      icon: 'Clock',
      tone: 'warning',
    }
  }

  if (normalizedStripeStatus === 'connected') {
    return {
      status: 'stripe_ready',
      label: 'Stripe-ready',
      subtext: null,
      icon: 'CheckCircle2',
      tone: 'success',
    }
  }

  const claimStatus = normalizeStatusText(entity.claim_status ?? entity.claimStatus)
  const isClaimedByStatus = claimStatus.includes('claimed') && !claimStatus.includes('unclaimed')
  const isClaimed = entity.is_claimed === true || entity.isClaimed === true || isClaimedByStatus
  if (isClaimed) {
    return {
      status: 'claimed_no_stripe',
      label: 'Stripe setup needed',
      subtext: 'Payouts blocked until Stripe is connected',
      icon: 'AlertCircle',
      tone: 'warning',
    }
  }

  const invitedAt = normalizeDate(entity.invited_at ?? entity.invitedAt)
  const isInvited = Boolean(invitedAt || claimStatus.includes('invited') || claimStatus.includes('unclaimed'))
  if (isInvited) {
    return {
      status: 'invited',
      label: 'Awaiting claim',
      subtext: `Invited ${formatInviteAge(invitedAt, opts.nowMs)} · email sent`,
      icon: 'Clock',
      tone: 'muted',
    }
  }

  return null
}

function normalizeStripeStatus(value: string | null | undefined): 'connected' | 'pending' | 'restricted' | 'disabled' | null {
  const normalized = normalizeStatusText(value)
  if (!normalized) return null

  if (/(restricted|requirements_due|requirements_past_due|past_due|payouts_blocked|charges_blocked)/.test(normalized)) return 'restricted'
  if (/(disabled|deauthorized|disconnected|rejected)/.test(normalized)) return 'disabled'
  if (/(pending|in_progress|onboarding|incomplete|verification)/.test(normalized)) return 'pending'
  if (/(connected|complete|enabled|active|ready)/.test(normalized)) return 'connected'
  return null
}

function normalizeStatusText(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? value : null
}

function formatCents(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function formatReadableDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function formatInviteAge(value: string | null, nowMs = Date.now()) {
  if (!value) return 'recently'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'recently'

  const diffSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000))
  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays >= 30) return '30 days ago'
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

function entityLabel(entityType: 'venue' | 'vendor') {
  return entityType === 'venue' ? 'the venue' : 'the vendor'
}
