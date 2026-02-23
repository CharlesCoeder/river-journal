-- Migration: Create flows table
-- Core journal content. Content is encrypted client-side before storage.

CREATE TABLE flows (
  id              UUID        PRIMARY KEY,
  daily_entry_id  UUID        NOT NULL REFERENCES daily_entries(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL,
  word_count      INTEGER     NOT NULL DEFAULT 0,
  is_deleted      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

-- Users can only read flows belonging to their own daily entries
CREATE POLICY "flows_select_own"
  ON flows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM daily_entries 
      WHERE daily_entries.id = flows.daily_entry_id 
      AND daily_entries.user_id = (SELECT auth.uid())
    )
  );

-- Users can only insert flows into their own daily entries
CREATE POLICY "flows_insert_own"
  ON flows FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_entries 
      WHERE daily_entries.id = flows.daily_entry_id 
      AND daily_entries.user_id = (SELECT auth.uid())
    )
  );

-- Users can only update flows belonging to their own daily entries
CREATE POLICY "flows_update_own"
  ON flows FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM daily_entries 
      WHERE daily_entries.id = flows.daily_entry_id 
      AND daily_entries.user_id = (SELECT auth.uid())
    )
  );
