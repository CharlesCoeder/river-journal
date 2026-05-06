-- Migration: Create collective_posts table (the foundation table for the
-- plaintext, server-visible community surface).
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- This table has RLS enabled with NO SELECT policy. All reads flow through
-- SECURITY DEFINER RPCs `collective_feed_page` and `collective_thread_page`
-- (defined in 20260506000006_add_collective_read_rpcs.sql), which internally
-- evaluate the daily-500-words gate and dispatch full-vs-preview shape.
-- Adding a SELECT policy here would defeat the server-side preview-vs-full
-- posting gate. DO NOT add a SELECT policy. The companion REVOKE at the
-- bottom of this migration is the belt-and-suspenders defense if RLS is ever
-- toggled off.
--
-- Architecture: D2 (encryption boundary — plaintext, server-visible),
--               D5 (server-side RLS posting gate — enforced via INSERT
--                   policy in 20260506000004_add_collective_rls_policies.sql),
--               D7 (TanStack Query domain; access lives in
--                   packages/app/state/collective/**, NOT syncedSupabase).

CREATE TABLE collective_posts (
  id              UUID        PRIMARY KEY,
  -- NULLABLE: account-deletion soft-anonymizes posts by setting user_id = NULL.
  -- FK ON DELETE SET NULL makes this anonymization a single statement.
  user_id         UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  -- Self-FK ON DELETE CASCADE: when a parent is hard-deleted, replies cascade.
  -- This path is currently unused (deletes go through delete_my_post which is
  -- soft) but locks the constraint shape for future moderation flows.
  parent_post_id  UUID        NULL REFERENCES collective_posts(id) ON DELETE CASCADE,
  body            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_removed      BOOLEAN     NOT NULL DEFAULT FALSE,
  removed_reason  TEXT        NULL,
  removed_at      TIMESTAMPTZ NULL,
  is_user_deleted BOOLEAN     NOT NULL DEFAULT FALSE,
  user_deleted_at TIMESTAMPTZ NULL
);

-- Index for thread reads (replies of a parent, newest first).
CREATE INDEX collective_posts_parent_id_created_at_idx
  ON collective_posts (parent_post_id, created_at DESC);

-- Index for the feed read path (top-level rows, newest first).
CREATE INDEX collective_posts_created_at_idx
  ON collective_posts (created_at DESC);

-- Reuse the existing handle_times() trigger from
-- 20260301000000_add_updated_at_triggers.sql. Do NOT redefine the function.
CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON collective_posts
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();

-- Enable Row Level Security. With NO policy, all direct SELECTs are denied.
-- Policies that DO get created (INSERT only) live in 20260506000004.
ALTER TABLE collective_posts ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: revoke Supabase's default CRUD grants and re-grant only
-- INSERT to authenticated. The DEFINER-RPC owner role retains SELECT via
-- table ownership (postgres). RLS is the *primary* gate; the GRANT
-- revocation is the belt-and-suspenders backstop if RLS is ever toggled off.
REVOKE ALL ON TABLE collective_posts FROM anon, authenticated;
GRANT INSERT ON TABLE collective_posts TO authenticated;

-- ============================================================================
-- Carryover-index reality check + missing-index creation
-- ============================================================================
-- daily_500_completed_today() (defined in the next migration) joins flows to
-- daily_entries on every collective INSERT (the gate predicate fires for the
-- INSERT policy). Performance depends on:
--   (a) daily_entries(user_id, entry_date) — present via the unique-constraint-
--       backed index daily_entries_user_id_entry_date_key. Verified below by
--       column list (NOT by name — the existing index has the _key suffix).
--   (b) flows(daily_entry_id) — Postgres does NOT auto-index FK columns. The
--       v1 schema has no explicit index. We create it here.
--
-- Override: a `-- no-collective-index-check` line earlier in this file
-- (above this block) disables the verification block for environments with
-- legitimate index divergence.

CREATE INDEX IF NOT EXISTS flows_daily_entry_id_idx
  ON flows (daily_entry_id);

DO $$
DECLARE
  v_skip BOOLEAN := FALSE;
  v_has_index BOOLEAN;
BEGIN
  -- Check for the override marker. We read this migration's own source via
  -- pg_read_file is not portable, so the marker is honored by a textual
  -- pre-grep at the migration-runner level (Story 9-5 CI). For local
  -- supabase db reset, the marker is informational; the verification still
  -- runs. (Documented limitation; the verification covers both flow paths.)
  IF v_skip THEN
    RETURN;
  END IF;

  -- Match by column list, NOT by name. The existing index is
  -- daily_entries_user_id_entry_date_key (suffix _key, from the unique
  -- constraint), and a future migration could rename it.
  SELECT EXISTS (
    SELECT 1
    FROM pg_indexes pi
    JOIN pg_class c ON c.relname = pi.indexname
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'daily_entries'
      AND (
        SELECT array_agg(a.attname ORDER BY array_position(i.indkey::int[], a.attnum::int))
        FROM pg_attribute a
        WHERE a.attrelid = t.oid
          AND a.attnum = ANY(i.indkey)
      ) @> ARRAY['user_id', 'entry_date']::name[]
  ) INTO v_has_index;

  IF NOT v_has_index THEN
    RAISE EXCEPTION
      'collective_posts migration aborted: no index on daily_entries covering (user_id, entry_date). '
      'daily_500_completed_today() join performance depends on this index. '
      'If the divergence is intentional, add a `-- no-collective-index-check` marker '
      'above this DO block and re-run.';
  END IF;
END $$;
