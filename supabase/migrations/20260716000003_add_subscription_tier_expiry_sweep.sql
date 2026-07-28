-- Migration: the period-end tier-flip sweep + folded-in privilege/CHECK
-- hardening on public.users and subscription_receipts.
--
-- WHY A SWEEP. A cancelled subscription keeps users.subscription_tier at its
-- paid value until current_period_end passes; something must flip it to 'free'
-- afterward, or a cancelled user keeps paid cosmetics forever. A pg_cron SQL
-- sweep is chosen over a Stripe customer.subscription.deleted webhook because:
--   (a) it covers ALL THREE providers uniformly (a webhook is Stripe-only,
--       leaving Apple/Play period-end unhandled);
--   (b) it is pure SQL — no pg_net dispatch or new Edge Function (the flip is a
--       DB state change, not a provider call), so it is fully testable today;
--   (c) strong in-repo precedent (20260713000000_add_streak_reminder_cron.sql).
-- The Stripe webhook is explicitly deferred to a follow-up.
--
-- CRITICAL — GRACE-PERIOD ENTITLEMENT PREDICATE (load-bearing). "Currently
-- entitled" is NOT `status = 'active'` alone. The cancel path flips a cancelled
-- Stripe receipt to status = 'canceled' immediately (the cancel is confirmed
-- server-side), so an `active`-only predicate would treat a just-cancelled Stripe
-- user as un-entitled and downgrade them on the very next sweep — defeating
-- cancel-at-period-end (the user must keep paid access until current_period_end).
-- The entitling predicate is therefore
--   current_period_end > now() AND status IN ('active', 'canceled', 'past_due')
-- (the paid-through window INCLUDING the cancel-at-period-end grace window and a
-- dunning grace). 'pending' and 'expired' do NOT entitle.
--
-- CROSS-PLATFORM ENTITLEMENT (load-bearing). The entitling-row EXISTS check is
-- keyed on user_id across ALL providers, so a user with a still-active or
-- still-in-grace second-provider subscription is NOT downgraded.
--
-- COMP/ADMIN-GRANT CAVEAT. The sweep assumes receipt-backed entitlement is the
-- SOLE source of paid tier (consistent with the users.subscription_tier
-- client-write REVOKE). A future receipt-less comp grant would be stomped by the
-- sweep and must instead carry a synthetic entitling receipt or be excluded.

-- ============================================================================
-- 1. The period-end tier-flip sweep.
-- ============================================================================
--
-- Downgrade subscription_tier -> 'free' for every user who has NO entitling
-- receipt (and whose current tier is not already 'free'). The DB enum
-- public.subscription_tier includes 'free' — this writes it directly at the DB
-- level (the _shared/billing/types.ts SubscriptionTier TS union is paid-only and
-- is unrelated to this SQL flip).
--
-- SERVICE-ROLE-INTERNAL ONLY. EXECUTE is revoked from PUBLIC/authenticated and
-- granted to service_role; the scheduled cron runs it. search_path is pinned.
CREATE OR REPLACE FUNCTION expire_lapsed_subscription_tiers()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE users u
  SET subscription_tier = 'free'
  WHERE u.subscription_tier <> 'free'
    AND NOT EXISTS (
      SELECT 1
      FROM subscription_receipts r
      WHERE r.user_id = u.id
        AND r.current_period_end > NOW()
        AND r.status IN ('active', 'canceled', 'past_due')
    );
END;
$$;

-- Supabase's default privileges grant EXECUTE directly to anon/authenticated on
-- new public functions (not merely via PUBLIC), so revoking PUBLIC alone leaves
-- those explicit grants standing. Revoke all three client-reachable grants so the
-- sweep is service-role-only (a client role calling it fails with 42501).
REVOKE EXECUTE ON FUNCTION expire_lapsed_subscription_tiers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expire_lapsed_subscription_tiers() FROM anon;
REVOKE EXECUTE ON FUNCTION expire_lapsed_subscription_tiers() FROM authenticated;
GRANT  EXECUTE ON FUNCTION expire_lapsed_subscription_tiers() TO service_role;

-- ============================================================================
-- 2. Schedule the sweep daily.
-- ============================================================================
-- The flip is cosmetic-only (theme access; no money moves post-period), so a
-- bounded sub-day lag past current_period_end is acceptable — run DAILY, not
-- every 15 minutes. pg_cron is hosted-only and absent in local dev; skip
-- gracefully so the migration applies cleanly in both places (exact
-- 20260713000000_add_streak_reminder_cron.sql precedent). Pure SQL — no pg_net /
-- Edge Function dispatch needed (the flip is a DB state change). Post-deploy the
-- runbook must verify a cron.job named 'subscription-tier-expiry' exists so a
-- missing extension is not a silent forever-paid bug.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'subscription-tier-expiry',
      '17 3 * * *',
      'SELECT expire_lapsed_subscription_tiers()'
    );
  END IF;
END
$$;

-- ============================================================================
-- 3. Folded-in hardening: close the users INSERT path the same way UPDATE was
--    closed (20260716000001_add_users_subscription_tier.sql).
-- ============================================================================
--
-- MECHANISM — why a bare column REVOKE is not enough (identical to the UPDATE
-- fix). Supabase grants authenticated a TABLE-level INSERT on public.users, which
-- authorizes every column regardless of any column-level grant record. A
-- column-scoped `REVOKE INSERT (subscription_tier)` is therefore a no-op while
-- the table-wide grant stands. The only way to deny one column while leaving the
-- rest insertable is to REVOKE the table-level INSERT and re-GRANT INSERT on
-- every column EXCEPT subscription_tier — the SAME column allow-list as the
-- UPDATE grant. service_role is not touched.
--
-- MAINTENANCE — the allow-list below must stay EXACTLY every users column except
-- subscription_tier. A future ADD COLUMN that forgets to extend BOTH this list
-- and the UPDATE allow-list silently reopens client write access to the new
-- column; the regression suite asserts allow-list completeness dynamically to
-- catch exactly that.
--
-- Verified safe: no client code in packages/app calls .from('users').insert(...)
-- — all row creation goes through the SECURITY DEFINER bootstrap RPCs, which run
-- with definer privileges and are unaffected by this authenticated-role grant.
-- INSERT-path self-promotion is not exploitable today (the PK blocks a re-INSERT
-- while the signup-created row exists, and there is no users DELETE policy), but
-- this closes the path belt-and-suspenders should a DELETE policy ever be added.
REVOKE INSERT ON public.users FROM anon, authenticated;
GRANT INSERT (
  id,
  encryption_mode,
  encryption_salt,
  encryption_key_verifier,
  managed_encryption_key,
  preferences,
  age_attested_at,
  timezone,
  created_at,
  updated_at
) ON public.users TO authenticated;

-- ============================================================================
-- 4. Folded-in hardening: tighten the provider_subscription_id CHECK to reject
--    whitespace-only ids (not just an exact empty string).
-- ============================================================================
-- The original CHECK (provider_subscription_id <> '') admits '   ', which would
-- collide under the UNIQUE natural key and match nothing at read time. btrim
-- rejects whitespace-only ids.
ALTER TABLE subscription_receipts
  DROP CONSTRAINT subscription_receipts_provider_subscription_id_check;
ALTER TABLE subscription_receipts
  ADD CONSTRAINT subscription_receipts_provider_subscription_id_check
  CHECK (btrim(provider_subscription_id) <> '');
