import 'server-only'

import type Stripe from 'stripe'
import { getStripeClient } from '@/lib/stripe/connect'

export type BuilderPaymentMethodDb = {
  from: (table: string) => any
}

export type SafeBuilderPaymentMethod = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

type BuilderPaymentMethodStripeClient = {
  customers: {
    listPaymentMethods: (
      customerId: string,
      params: { type: 'card' }
    ) => PromiseLike<{ data: Stripe.PaymentMethod[] }>
    retrievePaymentMethod: (
      customerId: string,
      paymentMethodId: string
    ) => PromiseLike<Stripe.PaymentMethod>
  }
  setupIntents: {
    create: (
      params: {
        customer: string
        usage: 'on_session'
        payment_method_types: ['card']
        metadata: Record<string, string>
      },
      options: { idempotencyKey: string }
    ) => PromiseLike<Stripe.SetupIntent>
    retrieve: (setupIntentId: string) => PromiseLike<Stripe.SetupIntent>
  }
}

type LocalPaymentMethodRow = {
  stripe_payment_method_id: string
  is_default?: boolean | null
}

export class BuilderPaymentMethodFlowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'BuilderPaymentMethodFlowError'
  }
}

/**
 * Proves a client-selected PaymentMethod is attached to the authenticated
 * organizer's server-derived Stripe Customer before any payment authorization
 * is reserved or created.
 */
export async function assertBuilderPaymentMethodOwnership(input: {
  customerId: string
  paymentMethodId: string
  stripe?: BuilderPaymentMethodStripeClient
}): Promise<Stripe.PaymentMethod> {
  const stripe = input.stripe ?? getBuilderPaymentMethodStripeClient()
  let paymentMethod: Stripe.PaymentMethod

  try {
    paymentMethod = await stripe.customers.retrievePaymentMethod(
      input.customerId,
      input.paymentMethodId
    )
  } catch (error) {
    if (isStripeResourceMissingError(error)) throw paymentMethodOwnershipError()
    throw new BuilderPaymentMethodFlowError(
      'Stripe payment-method ownership could not be verified. Retry safely.',
      'builder_payment_method_verification_unavailable',
      503
    )
  }

  if (
    paymentMethod.type !== 'card' ||
    !paymentMethod.card ||
    getStripeObjectId(paymentMethod.customer) !== input.customerId
  ) {
    throw paymentMethodOwnershipError()
  }

  return paymentMethod
}

/**
 * Lists card PaymentMethods currently attached to the organizer's Stripe
 * Customer. Stripe is authoritative for membership; the local table only adds
 * non-sensitive display preferences.
 */
export async function listBuilderPaymentMethods(input: {
  db: BuilderPaymentMethodDb
  builderId: string
  customerId: string
  stripe?: BuilderPaymentMethodStripeClient
}): Promise<SafeBuilderPaymentMethod[]> {
  const stripe = input.stripe ?? getBuilderPaymentMethodStripeClient()
  const [stripeMethods, localResult] = await Promise.all([
    stripe.customers.listPaymentMethods(input.customerId, { type: 'card' }),
    input.db
      .from('builder_payment_methods')
      .select('stripe_payment_method_id, is_default')
      .eq('builder_id', input.builderId),
  ])

  if (localResult.error) {
    throw new BuilderPaymentMethodFlowError(
      'Unable to load saved payment-method preferences.',
      'builder_payment_methods_read_failed',
      500
    )
  }

  const defaults = new Set(
    ((localResult.data ?? []) as LocalPaymentMethodRow[])
      .filter((row) => row.is_default === true)
      .map((row) => row.stripe_payment_method_id)
  )

  return stripeMethods.data.flatMap((paymentMethod) => {
    const summary = toSafeCardSummary(paymentMethod, defaults.has(paymentMethod.id))
    return summary ? [summary] : []
  })
}

/**
 * Creates a Customer-backed SetupIntent for an organizer-present, on-session
 * card binding. The caller supplies a stable attempt UUID so network retries
 * reuse the same Stripe object.
 */
export async function createBuilderPaymentMethodSetupIntent(input: {
  builderId: string
  userId: string
  customerId: string
  setupAttemptId: string
  stripe?: BuilderPaymentMethodStripeClient
}) {
  const stripe = input.stripe ?? getBuilderPaymentMethodStripeClient()
  const setupIntent = await stripe.setupIntents.create(
    {
      customer: input.customerId,
      usage: 'on_session',
      payment_method_types: ['card'],
      metadata: {
        payment_kind: 'planner_builder_payment_method',
        builder_id: input.builderId,
        user_id: input.userId,
        setup_attempt_id: input.setupAttemptId,
      },
    },
    {
      idempotencyKey: buildSetupIntentIdempotencyKey(input.builderId, input.setupAttemptId),
    }
  )

  if (!setupIntent.client_secret) {
    throw new BuilderPaymentMethodFlowError(
      'Stripe did not return a secure payment-method setup secret.',
      'builder_payment_method_setup_unavailable',
      502
    )
  }

  return {
    setupIntentId: setupIntent.id,
    clientSecret: setupIntent.client_secret,
  }
}

/**
 * Re-reads the completed SetupIntent and its Customer-scoped PaymentMethod
 * before storing safe card display metadata. Replays are idempotent through the
 * PaymentMethod id's existing unique constraint.
 */
export async function confirmBuilderPaymentMethodSetup(input: {
  db: BuilderPaymentMethodDb
  builderId: string
  userId: string
  customerId: string
  setupIntentId: string
  stripe?: BuilderPaymentMethodStripeClient
}): Promise<SafeBuilderPaymentMethod> {
  const stripe = input.stripe ?? getBuilderPaymentMethodStripeClient()
  let setupIntent: Stripe.SetupIntent

  try {
    setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId)
  } catch (error) {
    if (isStripeResourceMissingError(error)) throw paymentMethodOwnershipError()
    throw new BuilderPaymentMethodFlowError(
      'Stripe payment-method setup could not be verified. Retry safely.',
      'builder_payment_method_verification_unavailable',
      503
    )
  }

  const setupCustomerId = getStripeObjectId(setupIntent.customer)
  if (
    setupCustomerId !== input.customerId ||
    setupIntent.metadata?.builder_id !== input.builderId ||
    setupIntent.metadata?.user_id !== input.userId
  ) {
    throw paymentMethodOwnershipError()
  }

  if (setupIntent.status !== 'succeeded') {
    throw new BuilderPaymentMethodFlowError(
      'Complete the secure card setup before saving this payment method.',
      'builder_payment_method_setup_incomplete',
      409
    )
  }

  const paymentMethodId = getStripeObjectId(setupIntent.payment_method)
  if (!paymentMethodId) {
    throw new BuilderPaymentMethodFlowError(
      'The completed Stripe setup is missing a payment method.',
      'builder_payment_method_missing',
      422
    )
  }

  const paymentMethod = await assertBuilderPaymentMethodOwnership({
    customerId: input.customerId,
    paymentMethodId,
    stripe,
  })

  const summary = toSafeCardSummary(paymentMethod, false)
  if (!summary) {
    throw new BuilderPaymentMethodFlowError(
      'Only organizer-owned card payment methods are supported for planner deposits.',
      'builder_payment_method_unsupported',
      422
    )
  }

  const { data, error } = await input.db
    .from('builder_payment_methods')
    .upsert(
      {
        builder_id: input.builderId,
        stripe_payment_method_id: paymentMethod.id,
        card_brand: summary.brand,
        card_last4: summary.last4,
        card_exp_month: summary.expMonth,
        card_exp_year: summary.expYear,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_payment_method_id' }
    )
    .select('stripe_payment_method_id, card_brand, card_last4, card_exp_month, card_exp_year, is_default')
    .single()

  if (error || !data) {
    throw new BuilderPaymentMethodFlowError(
      'The verified payment method could not be saved.',
      'builder_payment_method_save_failed',
      500
    )
  }

  return {
    id: String(data.stripe_payment_method_id),
    brand: String(data.card_brand),
    last4: String(data.card_last4),
    expMonth: Number(data.card_exp_month),
    expYear: Number(data.card_exp_year),
    isDefault: data.is_default === true,
  }
}

export function buildSetupIntentIdempotencyKey(builderId: string, setupAttemptId: string) {
  return `planner_payment_method_setup_${builderId}_${setupAttemptId}`
}

function getBuilderPaymentMethodStripeClient() {
  return getStripeClient() as unknown as BuilderPaymentMethodStripeClient
}

function toSafeCardSummary(
  paymentMethod: Stripe.PaymentMethod,
  isDefault: boolean
): SafeBuilderPaymentMethod | null {
  if (paymentMethod.type !== 'card' || !paymentMethod.card) return null

  return {
    id: paymentMethod.id,
    brand: paymentMethod.card.brand,
    last4: paymentMethod.card.last4,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
    isDefault,
  }
}

function getStripeObjectId(value: string | { id: string } | null | undefined) {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function paymentMethodOwnershipError() {
  return new BuilderPaymentMethodFlowError(
    'This payment method is not attached to the authenticated organizer.',
    'builder_payment_method_forbidden',
    403
  )
}

function isStripeResourceMissingError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const stripeError = error as {
    code?: string
    raw?: { code?: string }
    statusCode?: number
  }
  return (
    stripeError.code === 'resource_missing' ||
    stripeError.raw?.code === 'resource_missing' ||
    stripeError.statusCode === 404
  )
}
