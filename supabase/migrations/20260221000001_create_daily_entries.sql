-- Migration: Create daily_entries table
-- Groups flows by user and calendar date.

CREATE TABLE daily_entries (
  id         UUID        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date DATE        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT daily_entries_user_id_entry_date_key UNIQUE (user_id, entry_date)
);

-- Enable Row Level Security
ALTER TABLE daily_entries ENABLE ROW LEVEL SECURITY;

-- Users can only read their own daily entries
CREATE POLICY "daily_entries_select_own"
  ON daily_entries FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Users can only insert their own daily entries
CREATE POLICY "daily_entries_insert_own"
  ON daily_entries FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Users can only update their own daily entries
CREATE POLICY "daily_entries_update_own"
  ON daily_entries FOR UPDATE
  USING (user_id = (SELECT auth.uid()));
