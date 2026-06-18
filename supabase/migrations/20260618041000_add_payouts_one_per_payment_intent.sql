-- Migration: Enforce one payout row per planner deposit payment intent
-- Created: 2026-06-18
-- Context: Concurrent capture reconcilers can race after selecting the same
-- captured payment_intents row. The loser should skip on 23505, not create a
-- duplicate payout row.

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
  FROM (
    SELECT payment_intent_id
    FROM public.payouts
    GROUP BY payment_intent_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add payout uniqueness guard: % payment_intent_id value(s) already have duplicate payouts',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_per_payment_intent
  ON public.payouts (payment_intent_id);

COMMENT ON INDEX public.payouts_one_per_payment_intent IS
  'Enforces at most one payout per payment_intent. Reconciler and capture inserts handle 23505 by skipping.';
