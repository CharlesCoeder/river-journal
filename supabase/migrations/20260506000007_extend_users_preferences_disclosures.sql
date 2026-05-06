-- Migration: Extend users.preferences JSONB with disclosures key.
-- Mirrors the additive pattern from
-- 20260505000000_extend_users_preferences_unlocked_themes.sql. Body is
-- purely a JSONB key extension — no DROP, no NOT NULL, no schema breakage.
-- Idempotent: re-running is a no-op on rows where the key already exists.
--
-- Shape extension on users.preferences (JSONB):
--   {
--     ...existing keys,
--     disclosures: {
--       collective_post_v1?: { acknowledged_at: string },
--       ai_cloud_v1?:        { acknowledged_at: string }   // reserved (Growth phase)
--     }
--   }
--
-- The disclosures.collective_post_v1.acknowledged_at value is written by the
-- client via Legend-State on the
-- store$.profile.preferences.disclosures.collective_post_v1.acknowledged_at
-- path (the client wires the write when the disclosure primitive ships).
-- The client tolerates rows where the key is absent (treated as
-- not-yet-acknowledged).
--
-- No RLS change — existing users_select_own / users_update_own policies
-- cover the new key (RLS is row-scoped; JSONB key additions are within-row).

UPDATE users
SET preferences = jsonb_set(
  preferences,
  '{disclosures}',
  '{}'::jsonb,
  true  -- create_missing
)
WHERE NOT (preferences ? 'disclosures');
