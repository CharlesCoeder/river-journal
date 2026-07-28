-- Migration: Extend users.preferences JSONB with a feature_flags key.
-- Mirrors the additive pattern from
-- 20260711000008_extend_users_preferences_moderation_receipts.sql. Body is
-- purely a JSONB key extension — no DROP, no NOT NULL, no schema breakage.
-- Idempotent: re-running is a no-op on rows where the key already exists (the
-- WHERE NOT (preferences ? 'feature_flags') guard).
--
-- Shape extension on users.preferences (JSONB):
--   {
--     ...existing keys,
--     feature_flags: {
--       external_billing_link_enabled: boolean   // default false
--     }
--   }
--
-- external_billing_link_enabled is a UI-SURFACE CONTROL ONLY — it gates whether
-- an external-link billing affordance is shown. The server enforces ALL
-- paid-feature gating via users.subscription_tier, NEVER via this flag.
-- Consumers must treat an absent flag as false regardless (defensive default),
-- same as every other optional preferences key.
--
-- preferences is NOT NULL DEFAULT '{}', so the WHERE NOT (preferences ? ...)
-- guard cannot skip or NULL-out a legacy row — no COALESCE needed. This
-- rewrites every matching pre-existing row exactly once (a full-table write on
-- current volume, run as its own migration).
--
-- No RLS change — existing users_select_own / users_update_own policies cover
-- the new key (RLS is row-scoped; JSONB key additions are within-row).

UPDATE users
SET preferences = jsonb_set(
  preferences,
  '{feature_flags}',
  '{"external_billing_link_enabled": false}'::jsonb,
  true  -- create_missing
)
WHERE NOT (preferences ? 'feature_flags');
