-- Migration: add users.age_attested_at
--
-- Records the one-time "I confirm I am 13 or older." attestation that a user
-- must check before creating an account. This is a self-declared, once-only
-- signal — a nullable TIMESTAMPTZ stamped exactly once on the first successful
-- signup (NULL = not yet attested). It is written by a direct client-side
-- Supabase UPDATE, null-guarded so a returning user re-checking the box is a
-- no-op.
--
-- Deliberately a FIRST-CLASS column, NOT a key under users.preferences:
-- preferences holds mutable, client-extensible settings (themes, disclosures,
-- hidden posts); the age attestation is neither mutable nor an editable
-- setting, so it belongs in its own column.
--
-- No new RLS is required. The existing owner-scoped policies from
-- 20260221000000_create_users.sql already cover this column:
--   - users_select_own  (owner-only SELECT)
--   - users_update_own  (owner-only UPDATE — authorizes the attestation write)
-- The handle_new_user trigger is unaffected because the column is nullable
-- with no default (new rows simply start NULL).
--
-- Forward-only, additive.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS age_attested_at TIMESTAMPTZ;
