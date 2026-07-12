-- Migration: Create user_push_tokens table
-- Architecture: D1 (schema additions), D2 (encryption boundary — plaintext table),
--               D7 (state-library boundary — synced via syncedSupabase, not TanStack).
-- Plaintext-via-syncedSupabase sibling pattern (same as user_grace_days).
--
-- Purpose: substrate for push-notification fan-out. Device push tokens are
-- registered by the mobile client after the first-streak permission ask, and
-- read server-side (service-role client, bypasses RLS) to fan out streak /
-- reply / moderation notifications to a user's live devices.

CREATE TABLE user_push_tokens (
  id              UUID        PRIMARY KEY,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT        NOT NULL,
  platform        TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  device_label    TEXT        NULL,
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- updated_at is REQUIRED even though the column list in the schema note omits
  -- it: the handle_times trigger below and the global changesSince/fieldUpdatedAt
  -- sync config both depend on the column existing. Mirrors user_grace_days.
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevents duplicate registrations of the same token for the same user.
  -- Named conventionally so the client's register-token upsert can target it
  -- with ON CONFLICT (a re-register of the same token touches last_used_at
  -- rather than inserting a duplicate).
  CONSTRAINT user_push_tokens_user_id_expo_push_token_key
    UNIQUE (user_id, expo_push_token)
);

-- Index for fan-out lookups: "all live tokens for this user"
-- (WHERE user_id = ? AND is_deleted = false). A plain (user_id) index is
-- sufficient here; a partial index is deliberately deferred until profiling
-- warrants it.
CREATE INDEX user_push_tokens_user_id_idx ON user_push_tokens (user_id);

-- Enable Row Level Security
ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;

-- FOUR policies, all self-scoped to auth.uid() = user_id: a caller can only
-- ever see, create, modify, or remove their own rows.
--
-- The soft-delete path (is_deleted = true via UPDATE, driven by the global
-- fieldDeleted: 'is_deleted' sync config) remains the primary lifecycle for a
-- token going out of service. The explicit DELETE policy exists to permit a
-- genuine hard-delete of a user's own row if ever needed. Invalid-token pruning
-- by the fan-out Edge Functions happens via the service-role client, which
-- bypasses RLS entirely — these policies do not govern that path.

-- Users can only read their own push tokens
CREATE POLICY "user_push_tokens_select_own"
  ON user_push_tokens FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Users can only insert their own push tokens
CREATE POLICY "user_push_tokens_insert_own"
  ON user_push_tokens FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Users can only update their own push tokens (soft-delete sets is_deleted=true via UPDATE)
CREATE POLICY "user_push_tokens_update_own"
  ON user_push_tokens FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- Users can hard-delete their own push tokens
CREATE POLICY "user_push_tokens_delete_own"
  ON user_push_tokens FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- Belt-and-suspenders grants (mirrors user_blocks): strip default CRUD grants
-- and re-grant to `authenticated` only. anon gets nothing, so an anon caller is
-- denied at the privilege layer (SQLSTATE 42501) rather than silently seeing an
-- RLS-filtered empty result. The four self-scoped policies above still govern
-- which rows an authenticated caller may touch. UPDATE is granted (unlike
-- user_blocks) because the soft-delete + last_used_at lifecycle needs it.
REVOKE ALL ON TABLE user_push_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_push_tokens TO authenticated;

-- Reuse the existing handle_times() function from 20260301000000_add_updated_at_triggers.sql
-- DO NOT redefine the function here.
CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON user_push_tokens
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();
