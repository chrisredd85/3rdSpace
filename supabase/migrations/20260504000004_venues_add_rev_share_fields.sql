-- Migration: Add venue revenue share fields for public catalog reads
-- Created: 2026-05-04

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ticket_sales_share_enabled  boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_sales_share_pct      numeric(5,2)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bar_rev_share_enabled       boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bar_rev_share_pct           numeric(5,2)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsor_rev_share_enabled   boolean        NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsor_rev_share_pct       numeric(5,2)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_head_kickback_cents     integer        NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.venues.ticket_sales_share_pct    IS 'Percentage of gross ticket revenue shared with 3rdSpace (0-100)';
COMMENT ON COLUMN public.venues.bar_rev_share_pct         IS 'Percentage of bar revenue shared with 3rdSpace (0-100)';
COMMENT ON COLUMN public.venues.sponsor_rev_share_pct     IS 'Percentage of sponsor revenue shared with 3rdSpace (0-100)';
COMMENT ON COLUMN public.venues.per_head_kickback_cents   IS 'Fixed kickback in cents per confirmed attendee';
