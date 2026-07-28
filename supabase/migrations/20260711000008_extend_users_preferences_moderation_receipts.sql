-- Migration: Extend users.preferences JSONB with a moderationReceipts key.
-- Mirrors the additive pattern from
-- 20260506000007_extend_users_preferences_disclosures.sql. Body is purely a
-- JSONB key extension — no DROP, no NOT NULL, no schema breakage. Idempotent:
-- re-running is a no-op on rows where the key already exists.
--
-- Shape extension on users.preferences (JSONB):
--   {
--     ...existing keys,
--     moderationReceipts: {
--       "removed_post:<postId>:<removed_at>"?: { acknowledged_at: string },
--       "suspension:<suspensionId>"?:          { acknowledged_at: string }
--     }
--   }
--
-- The moderationReceipts.<receiptId>.acknowledged_at value is written by the
-- client via Legend-State on the
-- store$.profile.preferences.moderationReceipts.<receiptId>.acknowledged_at
-- path when the affected user dismisses an in-app moderation receipt. The
-- <receiptId> for a removed post embeds the RAW removed_at so a
-- remove → reinstate → re-remove cycle yields a fresh (unacknowledged)
-- receipt. The client tolerates rows where the key is absent (treated as
-- not-yet-acknowledged).
--
-- No RLS change — existing users_select_own / users_update_own policies cover
-- the new key (RLS is row-scoped; JSONB key additions are within-row).

UPDATE users
SET preferences = jsonb_set(
  preferences,
  '{moderationReceipts}',
  '{}'::jsonb,
  true  -- create_missing
)
WHERE NOT (preferences ? 'moderationReceipts');
