-- Migration: Create user_grace_days table
-- Architecture: D1 (schema additions), D2 (encryption boundary — plaintext table),
--               D3 (client-authoritative streak/grace; server-passive)
-- First v2 migration; establishes the plaintext-via-syncedSupabase sibling pattern.

CREATE TABLE user_grace_days (
  id                   UUID        PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  earned_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  earned_for_milestone INTEGER     NOT NULL,
  used_for_date        TEXT        NULL,    -- 'YYYY-MM-DD' (timezone-agnostic; mirrors entries.entryDate semantics, NOT a DATE type)
  is_deleted           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the streak-compute hot path: "all grace days for this user, grouped by used vs. unused"
CREATE INDEX user_grace_days_user_id_used_for_date_idx
  ON user_grace_days (user_id, used_for_date);

-- Enable Row Level Security
ALTER TABLE user_grace_days ENABLE ROW LEVEL SECURITY;

-- Users can only read their own grace days
CREATE POLICY "user_grace_days_select_own"
  ON user_grace_days FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Users can only insert their own grace days
CREATE POLICY "user_grace_days_insert_own"
  ON user_grace_days FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Users can only update their own grace days (soft-delete sets is_deleted=true via UPDATE)
CREATE POLICY "user_grace_days_update_own"
  ON user_grace_days FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- Reuse the existing handle_times() function from 20260301000000_add_updated_at_triggers.sql
-- DO NOT redefine the function here.
CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON user_grace_days
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();
