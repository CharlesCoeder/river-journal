-- Migration: Collective server-side hardening — audit 2026-07 (medium-severity batch).
--
-- Five independent server-side fixes, one per section:
--
--   1. delete_my_post also blanks the post TITLE on self-delete. The current
--      delete_my_post (20260506000005) predates the `title` column
--      (20260622000000) and only blanked `body`, so a user-deleted top-level
--      post's title stayed visible in every feed/thread tombstone (the read
--      RPCs return cp.title unconditionally — they do NOT null it out for
--      user-deleted rows). Blank title alongside body, and retro-blank any
--      already-tombstoned rows.
--
--   2. Server-stamp created_at on the public Collective tables. The shared
--      handle_times() trigger COALESCEs a client-supplied created_at on INSERT
--      — deliberate for the client-authoritative journal tables (daily_entries,
--      flows), but wrong for the public feed: a client could backdate/future-
--      date a post (created_at 2019 or 2030) and corrupt feed ordering + the
--      thread/feed keyset cursors. Force created_at = now() on INSERT for
--      collective_posts (ordering is load-bearing) and, for defense-in-depth
--      consistency, collective_reactions / collective_reports. The journal
--      tables' handle_times() behavior is left completely untouched.
--
--   3. Constrain collective_reactions.kind to the fixed client vocabulary. It
--      was free TEXT, served verbatim to every client via jsonb_object_agg in
--      the feed/thread reaction tally. The client only ever sends one of five
--      kinds (packages/app/state/collective/types.ts:13 ReactionKind /
--      reactions.ts:29 REACTION_KINDS). Add a CHECK limited to that set.
--
--   4. Pin search_path on the two SECURITY DEFINER functions that lacked it:
--      handle_new_user() (20260302000000) and cleanup_stale_trusted_browsers()
--      (20260313000000). Both predate the Collective story whose t11 test only
--      allowlisted its own five functions, so they were never checked.
--
--   5. Add the two missing FK indexes: collective_reactions.user_id and
--      collective_reports.reporter_user_id. (The post_id FK on both tables is
--      already covered — reactions by collective_reactions_post_id_idx, reports
--      by the leading column of the (post_id, reporter_user_id) unique index.)

-- ============================================================================
-- 1. delete_my_post — blank the title too on self-delete.
--
-- The title CHECK (20260622000000) requires a top-level post to carry a
-- non-blank 1–200 char title and a reply to carry NULL. So we blank the title
-- to the '[deleted]' sentinel ONLY for top-level posts (parent_post_id IS NULL)
-- and leave replies' title NULL — this keeps the CHECK satisfied while matching
-- how body is blanked. Everything else is reproduced verbatim from
-- 20260506000005 (ambiguous-error principle, idempotency precondition,
-- reaction cleanup, SECURITY DEFINER + pinned search_path, REVOKE/GRANT).
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_my_post(post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_post_id UUID := post_id;
  v_owner UUID;
  v_already_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'cannot delete this post' USING ERRCODE = '42501';
  END IF;

  SELECT cp.user_id, cp.is_user_deleted
  INTO v_owner, v_already_deleted
  FROM collective_posts cp
  WHERE cp.id = v_post_id;

  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid() OR v_already_deleted IS TRUE THEN
    RAISE EXCEPTION 'cannot delete this post' USING ERRCODE = '42501';
  END IF;

  -- Blank body AND title. Title only exists on top-level posts (the CHECK
  -- forbids a non-NULL title on replies), so blank it to the sentinel there and
  -- leave replies' NULL title untouched.
  UPDATE collective_posts
  SET body = '[deleted]',
      title = CASE WHEN parent_post_id IS NULL THEN '[deleted]' ELSE title END,
      is_user_deleted = TRUE,
      user_deleted_at = NOW()
  WHERE id = v_post_id;

  DELETE FROM collective_reactions
  WHERE post_id = v_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_my_post(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_my_post(UUID) TO authenticated;

-- Retro-blank any already-tombstoned top-level posts whose title still leaks
-- (rows deleted before this migration). Replies are untouched (title is NULL).
UPDATE collective_posts
SET title = '[deleted]'
WHERE is_user_deleted = TRUE
  AND parent_post_id IS NULL
  AND title IS DISTINCT FROM '[deleted]';

-- ============================================================================
-- 2. Server-stamp created_at on the Collective tables (INSERT only).
--
-- collective_posts currently uses the shared handle_times() trigger, which
-- COALESCEs a client-supplied created_at. Swap it for a Collective-specific
-- trigger that ALWAYS stamps created_at = now() on INSERT (updated_at handling
-- preserved). The journal tables keep the original handle_times() untouched.
--
-- collective_reactions / collective_reports have no handle_times trigger and
-- rely on the column DEFAULT now(), which a client can still override by
-- passing created_at explicitly. A BEFORE INSERT stamp closes that.
-- ============================================================================

-- Posts: created_at server-stamped on INSERT; updated_at behavior preserved.
--
-- Uses clock_timestamp() (real wall-clock, advances WITHIN a transaction), not
-- now()/transaction_timestamp() (frozen for the whole transaction). This is
-- deliberate: the feed/thread keyset cursors page on created_at, so two posts
-- created in the same transaction must NOT collide on an identical timestamp.
-- In production each post is its own request/transaction so this is moot, but
-- clock_timestamp() also makes batch/same-transaction inserts strictly ordered,
-- which is exactly the cursor-integrity property this fix is protecting.
CREATE OR REPLACE FUNCTION handle_collective_post_times()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    -- Server-authoritative: ignore any client-supplied created_at.
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
  ELSIF (TG_OP = 'UPDATE') THEN
    NEW.created_at := OLD.created_at;
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the generic handle_times trigger on collective_posts with the
-- server-stamping one. (Do NOT touch handle_times() itself — it still serves
-- daily_entries / flows / user_grace_days with client-authoritative timestamps.)
DROP TRIGGER IF EXISTS handle_times ON collective_posts;

CREATE TRIGGER handle_collective_post_times
  BEFORE INSERT OR UPDATE ON collective_posts
  FOR EACH ROW
EXECUTE PROCEDURE handle_collective_post_times();

-- Reactions / reports: force created_at = now() on INSERT.
CREATE OR REPLACE FUNCTION handle_collective_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- clock_timestamp() (see handle_collective_post_times) so same-transaction
  -- inserts never collide on an identical timestamp.
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS handle_collective_created_at ON collective_reactions;
CREATE TRIGGER handle_collective_created_at
  BEFORE INSERT ON collective_reactions
  FOR EACH ROW
EXECUTE PROCEDURE handle_collective_created_at();

DROP TRIGGER IF EXISTS handle_collective_created_at ON collective_reports;
CREATE TRIGGER handle_collective_created_at
  BEFORE INSERT ON collective_reports
  FOR EACH ROW
EXECUTE PROCEDURE handle_collective_created_at();

-- ============================================================================
-- 3. Constrain collective_reactions.kind to the client vocabulary.
--
-- Client source of truth: packages/app/state/collective/types.ts:13
--   export type ReactionKind = 'heart' | 'sparkle' | 'flame' | 'leaf' | 'wave'
-- Guard against pre-existing out-of-set rows before adding the CHECK. The
-- stack is dev-local (Collective is still behind the placeholder) so a
-- defensive DELETE is acceptable — there is no production data to migrate.
-- ============================================================================
DELETE FROM collective_reactions
WHERE kind NOT IN ('heart', 'sparkle', 'flame', 'leaf', 'wave');

ALTER TABLE collective_reactions
  ADD CONSTRAINT collective_reactions_kind_chk
  CHECK (kind IN ('heart', 'sparkle', 'flame', 'leaf', 'wave'));

-- ============================================================================
-- 4. Pin search_path on the two remaining unpinned SECURITY DEFINER functions.
--
-- Re-declared verbatim from their original migrations with the SET clause
-- added. Bodies are unchanged; triggers referencing them are preserved by
-- CREATE OR REPLACE.
-- ============================================================================

-- handle_new_user() (20260302000000): auto-creates public.users on auth signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- cleanup_stale_trusted_browsers() (20260313000000): scheduled stale-row purge.
CREATE OR REPLACE FUNCTION cleanup_stale_trusted_browsers()
  RETURNS INTEGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM trusted_browsers
  WHERE last_used_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Re-assert the grant posture (CREATE OR REPLACE preserves it, but be explicit).
REVOKE EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() FROM authenticated;
GRANT  EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() TO service_role;

-- ============================================================================
-- 5. Missing FK indexes.
-- ============================================================================
CREATE INDEX IF NOT EXISTS collective_reactions_user_id_idx
  ON collective_reactions (user_id);

CREATE INDEX IF NOT EXISTS collective_reports_reporter_user_id_idx
  ON collective_reports (reporter_user_id);
