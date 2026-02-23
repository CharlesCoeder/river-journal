-- Migration: Create users table
-- Linked to Supabase auth.users for authenticated user profiles.

CREATE TABLE users (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encryption_mode TEXT        NOT NULL DEFAULT 'e2e',
  encryption_salt TEXT,
  preferences     JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can only read their own profile
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (id = (SELECT auth.uid()));

-- Users can only insert their own profile
CREATE POLICY "users_insert_own"
  ON users FOR INSERT
  WITH CHECK (id = (SELECT auth.uid()));

-- Users can only update their own profile
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (id = (SELECT auth.uid()));
