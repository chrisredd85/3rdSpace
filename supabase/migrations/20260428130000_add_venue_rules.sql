-- ============================================================================
-- VENUE HOUSE RULES AND INSURANCE REQUIREMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'general',
  applies_to TEXT NOT NULL DEFAULT 'all',
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT venue_rules_rule_type_check
    CHECK (rule_type = ANY (ARRAY['general', 'insurance', 'safety', 'conduct'])),
  CONSTRAINT venue_rules_applies_to_check
    CHECK (applies_to = ANY (ARRAY['all', 'vendors', 'organizations', 'builders']))
);

ALTER TABLE public.venue_rules
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Venue rule',
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS rule_type TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS applies_to TEXT DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.venue_rules
  DROP CONSTRAINT IF EXISTS venue_rules_rule_type_check,
  DROP CONSTRAINT IF EXISTS venue_rules_applies_to_check;

ALTER TABLE public.venue_rules
  ADD CONSTRAINT venue_rules_rule_type_check
    CHECK (rule_type = ANY (ARRAY['general', 'insurance', 'safety', 'conduct'])),
  ADD CONSTRAINT venue_rules_applies_to_check
    CHECK (applies_to = ANY (ARRAY['all', 'vendors', 'organizations', 'builders']));

CREATE INDEX IF NOT EXISTS idx_venue_rules_venue_order
  ON public.venue_rules(venue_id, display_order);

CREATE INDEX IF NOT EXISTS idx_venue_rules_type
  ON public.venue_rules(rule_type);

ALTER TABLE public.venue_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view venue rules" ON public.venue_rules;
CREATE POLICY "Anyone can view venue rules"
  ON public.venue_rules FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Venue owners can manage rules" ON public.venue_rules;
CREATE POLICY "Venue owners can manage rules"
  ON public.venue_rules FOR ALL
  USING (
    venue_id IN (
      SELECT v.id FROM public.venues v WHERE v.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT v.id FROM public.venues v WHERE v.owner_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_venue_rules_updated_at ON public.venue_rules;
CREATE TRIGGER update_venue_rules_updated_at
  BEFORE UPDATE ON public.venue_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
