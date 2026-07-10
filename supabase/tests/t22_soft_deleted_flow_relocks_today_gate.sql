-- t22: Soft-deleting today's qualifying flow re-locks the gate for the rest of
-- the day, but does NOT retract posts already made while qualified.
--
-- The predicate sums only flows WHERE is_deleted = FALSE, so flipping the
-- qualifying flow's is_deleted to TRUE drops the day's word total below 500 and
-- the gate closes on the very next evaluation — no persisted unlock survives.
-- A collective_posts row inserted earlier (while qualified) has an independent
-- lifecycle: soft-deleting the flow must not cascade to it (historical posting
-- is unaffected; posts only disappear under their own moderation/deletion).
--
-- Read note: the `authenticated` role has only an INSERT grant on
-- collective_posts (reads flow through the feed RPC, never a direct SELECT — see
-- t01), so a direct SELECT as the viewer raises permission_denied. To read the
-- raw row back for the persistence assertions we switch into the table-owning
-- `postgres` role (which bypasses RLS), then switch back to the viewer.
--
-- Seeded users default to users.timezone = 'UTC', so today is the UTC date.

BEGIN;
\i _helpers.psql
SELECT plan(6);

DO $$
DECLARE
  v_user    UUID;
  v_flow_id UUID;
  v_post_id UUID := gen_random_uuid();
  v_today   DATE := (NOW() AT TIME ZONE 'UTC')::date;
  v_gate    BOOLEAN;
  v_full    INT;
  v_preview INT;
  v_posts   INT;
BEGIN
  -- User is 500-completed today; capture the flow id so we can soft-delete
  -- exactly that flow later.
  v_user := test_seed_user();
  v_flow_id := test_seed_words_on_date(v_user, v_today, 500);
  PERFORM test_become(v_user);

  -- Pre-conditions: gate open, feed full.
  v_gate := daily_500_completed_today(v_user);
  PERFORM tap_ok(v_gate = TRUE, 'user with 500 today starts with an open gate (predicate TRUE)');

  -- The qualified user posts (valid title) — the RLS insert gate lets it land.
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post_id, v_user, 'Historical post t22', 'historical-post-t22');

  -- Read it back under the privileged role (viewer has no direct SELECT).
  PERFORM set_config('role', 'postgres', true);
  SELECT COUNT(*) INTO v_posts FROM collective_posts WHERE id = v_post_id;
  PERFORM tap_ok(v_posts = 1, 'qualified user post lands (1 row)');
  PERFORM test_become(v_user);

  SELECT COUNT(*) INTO v_full FROM collective_feed_page(NULL, 20) WHERE mode = 'full';
  PERFORM tap_ok(v_full > 0, 'qualified user feed returns full-mode rows');

  -- Soft-delete the qualifying flow (a user deleting their own flow via
  -- flows_update_own).
  UPDATE flows SET is_deleted = TRUE WHERE id = v_flow_id;

  -- (a) The gate immediately re-evaluates to FALSE — the deleted flow's words
  -- no longer count toward today's sum.
  v_gate := daily_500_completed_today(v_user);
  PERFORM tap_ok(v_gate = FALSE, 'soft-deleting the qualifying flow re-locks the gate (predicate FALSE)');

  -- (b) The feed drops back to preview.
  SELECT COUNT(*) INTO v_full    FROM collective_feed_page(NULL, 20) WHERE mode = 'full';
  SELECT COUNT(*) INTO v_preview FROM collective_feed_page(NULL, 20) WHERE mode = 'preview';
  PERFORM tap_ok(v_full = 0 AND v_preview > 0, 'feed reverts to preview mode after the flow is soft-deleted');

  -- (c) The already-inserted post is untouched — no cascade from the flow
  -- soft-delete; historical posting is unaffected.
  PERFORM set_config('role', 'postgres', true);
  SELECT COUNT(*) INTO v_posts
  FROM collective_posts
  WHERE id = v_post_id AND is_removed = FALSE;
  PERFORM tap_ok(v_posts = 1, 'previously-posted row persists after the flow soft-delete (historical posting unaffected)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
