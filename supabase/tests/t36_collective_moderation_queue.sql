-- t36: the admin-only moderation queue read path aggregates pending reports
-- into one row per reported post, protects reporter identity, and enforces
-- the authorization + ordering + pagination contract an operator depends on
-- to triage flagged content.
--
-- Coverage map:
--   A. authorization -- a non-admin authenticated caller AND an anonymous
--      caller are both rejected with SQLSTATE 42501.
--   B. aggregation shape -- one post with two pending reports comes back as
--      exactly one row with flag_count = 2 (not one row per report).
--   C. resolved-only exclusion -- a post whose reports are ALL reviewed or
--      dismissed does not appear in the queue.
--   D. removed-but-pending inclusion -- a post already marked removed still
--      appears as long as it retains a pending report.
--   E. reporter-identity privacy -- each element of the reports array has
--      exactly id/reason_code/note/created_at and NEVER a reporter_user_id
--      key, even when the underlying report row carries a real reporter.
--   F. latest-report preview -- latest_report_reason/note/at reflect the
--      NEWEST pending report on a post, not the oldest.
--   G. pending-only counting -- a post with one dismissed report and one
--      fresh pending report counts flag_count = 1 (resolved reports are
--      excluded from the tally, not just from row inclusion).
--   H. deterministic ordering -- two posts whose oldest pending report
--      shares an identical timestamp resolve their tie by post_id, and that
--      order is stable across repeated calls.
--   I. page_size clamp -- floor 1, ceiling 100. The ceiling case seeds >100
--      distinct pending-reported posts so the assertion is non-tautological
--      (with only a handful of pending posts, LEAST(page_size, total) and a
--      real ceiling of 100 are indistinguishable).
--   J. reply inclusion -- a reply (non-null parent, no title) with a pending
--      report is returned with title = NULL.
--   K. co-occurring deletion state -- a post whose author both self-deleted
--      the content AND no longer has an author row (account gone) still
--      returns with correct flags and a non-empty reports array; deletion
--      never drops a row out of the queue.
--
-- Red phase: the queue RPC does not exist yet, so the first uncaught call in
-- each DO block raises "function ... does not exist" rather than returning
-- rows. Blocks that only assert on a caught SQLSTATE (block A) resolve their
-- flags to FALSE and fail cleanly; every other block's first unguarded call
-- aborts the surrounding transaction outright, so no tap lines are emitted
-- for it. Both outcomes are an unambiguous suite failure pre-implementation.

BEGIN;
\i _helpers.psql
SELECT plan(22);

-- ==========================================================================
-- A. Authorization: non-admin authenticated caller AND anon are rejected.
-- ==========================================================================
DO $$
DECLARE
  v_non_admin UUID;
  v_state     TEXT;
  v_blocked_non_admin BOOLEAN := FALSE;
  v_blocked_anon      BOOLEAN := FALSE;
BEGIN
  v_non_admin := test_seed_user();

  PERFORM test_become(v_non_admin);
  BEGIN
    PERFORM * FROM collective_moderation_queue(100);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_blocked_non_admin := TRUE; END IF;
  END;

  PERFORM test_become_anon();
  BEGIN
    PERFORM * FROM collective_moderation_queue(100);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_blocked_anon := TRUE; END IF;
  END;

  RESET ROLE;

  PERFORM tap_ok(v_blocked_non_admin, 'a non-admin authenticated caller is rejected with 42501');
  PERFORM tap_ok(v_blocked_anon,      'an anonymous caller is rejected with 42501');
END $$;

-- ==========================================================================
-- B. Aggregation shape: one post + two pending reports -> one row, flag_count = 2.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep1   UUID;
  v_rep2   UUID;
  v_post   UUID := gen_random_uuid();
  v_rows   INT;
  v_flags  INT;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep1  := test_seed_user();
  v_rep2  := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Aggregation post', 'aggregation-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, note, status)
  VALUES (gen_random_uuid(), v_post, v_rep1, 'spam', NULL, 'pending');
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, note, status)
  VALUES (gen_random_uuid(), v_post, v_rep2, 'harassment', 'seems targeted', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_rows FROM collective_moderation_queue(100) WHERE post_id = v_post;
  SELECT flag_count INTO v_flags FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_rows = 1,  'a post with two pending reports yields exactly one aggregated row');
  PERFORM tap_ok(v_flags = 2, 'flag_count aggregates the pending-report count for that post');
END $$;

-- ==========================================================================
-- C. A post whose reports are ALL reviewed/dismissed does not appear.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep    UUID;
  v_post   UUID := gen_random_uuid();
  v_rows   INT;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Fully resolved post', 'resolved-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_rep, 'spam', 'dismissed');

  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_rows FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_rows = 0, 'a post with only dismissed/reviewed reports is excluded from the queue');
END $$;

-- ==========================================================================
-- D. A removed post that still has a pending report DOES appear.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep    UUID;
  v_post   UUID := gen_random_uuid();
  v_exists BOOLEAN;
  v_removed_flag BOOLEAN;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body, is_removed, removed_reason, removed_at)
  VALUES (v_post, v_owner, 'Already removed post', 'removed-body', TRUE, 'spam', NOW());

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_rep, 'spam', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT EXISTS(SELECT 1 FROM collective_moderation_queue(100) WHERE post_id = v_post) INTO v_exists;
  SELECT is_removed INTO v_removed_flag FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_exists,        'a removed post with a pending report remains in the queue');
  PERFORM tap_ok(v_removed_flag,  'the removed post carries is_removed = TRUE in the queue row');
END $$;

-- ==========================================================================
-- E. reports array shape + reporter-identity privacy.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep    UUID;
  v_post   UUID := gen_random_uuid();
  v_first_report JSONB;
  v_has_expected_keys BOOLEAN;
  v_leaks_reporter     BOOLEAN;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Privacy shape post', 'privacy-body');

  -- Seed a report with a REAL reporter_user_id, then assert the queue's
  -- reports array still omits it -- not merely that we forgot to add it.
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, note, status)
  VALUES (gen_random_uuid(), v_post, v_rep, 'off_topic', 'reported note text', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT reports -> 0 INTO v_first_report FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  v_has_expected_keys :=
    (v_first_report ? 'id') AND
    (v_first_report ? 'reason_code') AND
    (v_first_report ? 'note') AND
    (v_first_report ? 'created_at');
  v_leaks_reporter := v_first_report ? 'reporter_user_id';

  PERFORM tap_ok(v_has_expected_keys, 'each reports[] element has id/reason_code/note/created_at');
  PERFORM tap_ok(NOT v_leaks_reporter, 'reports[] omits reporter_user_id even when the base row has a real reporter');
END $$;

-- ==========================================================================
-- F. latest_report_* reflects the NEWEST pending report, not the oldest.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep_old UUID;
  v_rep_new UUID;
  v_post   UUID := gen_random_uuid();
  v_latest_reason TEXT;
  v_latest_note   TEXT;
  v_latest_at     TIMESTAMPTZ;
  v_new_at        TIMESTAMPTZ := NOW();
BEGIN
  v_admin   := test_seed_user();
  v_owner   := test_seed_user();
  v_rep_old := test_seed_user();
  v_rep_new := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Latest preview post', 'latest-preview-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, note, status, created_at)
  VALUES (gen_random_uuid(), v_post, v_rep_old, 'spam', 'older note', 'pending', v_new_at - INTERVAL '2 days');
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, note, status, created_at)
  VALUES (gen_random_uuid(), v_post, v_rep_new, 'harassment', 'newer note', 'pending', v_new_at);

  -- collective_reports carries a BEFORE INSERT trigger that stamps created_at
  -- with clock_timestamp() (server-authoritative timestamps; clients cannot
  -- backdate a report), so the created_at supplied to INSERT above is ignored.
  -- Set the intended relative order via UPDATE (no trigger fires on UPDATE) so
  -- the "newest pending report" preview is exercised deterministically.
  UPDATE collective_reports SET created_at = v_new_at - INTERVAL '2 days'
  WHERE post_id = v_post AND reporter_user_id = v_rep_old;
  UPDATE collective_reports SET created_at = v_new_at
  WHERE post_id = v_post AND reporter_user_id = v_rep_new;

  PERFORM test_become_admin(v_admin);
  SELECT latest_report_reason, latest_report_note, latest_report_at
  INTO v_latest_reason, v_latest_note, v_latest_at
  FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_latest_reason = 'harassment',   'latest_report_reason reflects the newest pending report');
  PERFORM tap_ok(v_latest_note = 'newer note',      'latest_report_note reflects the newest pending report');
  PERFORM tap_ok(v_latest_at = v_new_at,            'latest_report_at reflects the newest pending report timestamp');
END $$;

-- ==========================================================================
-- G. Pending-only counting: one dismissed + one fresh pending -> flag_count = 1.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep1   UUID;
  v_rep2   UUID;
  v_post   UUID := gen_random_uuid();
  v_flags  INT;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep1  := test_seed_user();
  v_rep2  := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_owner, 'Mixed status post', 'mixed-status-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_rep1, 'spam', 'dismissed');
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_rep2, 'spam', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT flag_count INTO v_flags FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_flags = 1, 'flag_count counts only pending reports, excluding dismissed ones on the same post');
END $$;

-- ==========================================================================
-- H. Deterministic ordering: equal oldest-pending timestamps break on post_id,
--    and the order is stable across repeated calls.
-- ==========================================================================
DO $$
DECLARE
  v_admin     UUID;
  v_owner     UUID;
  v_rep       UUID;
  -- Fixed, comparable ids so the post_id tiebreak is unambiguous.
  v_post_low  UUID := '00000000-0000-0000-0000-00000000aaaa';
  v_post_high UUID := '00000000-0000-0000-0000-00000000bbbb';
  -- Deliberately ancient so this pair is always the oldest-pending pair in
  -- the whole table, regardless of what earlier blocks seeded.
  v_tie_at    TIMESTAMPTZ := TIMESTAMPTZ '2000-01-01T00:00:00Z';
  v_first_call  UUID;
  v_second_call UUID;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post_low, v_owner, 'Tie post low', 'tie-post-low-body');
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post_high, v_owner, 'Tie post high', 'tie-post-high-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status, created_at)
  VALUES (gen_random_uuid(), v_post_low, v_rep, 'spam', 'pending', v_tie_at);
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status, created_at)
  VALUES (gen_random_uuid(), v_post_high, v_rep, 'spam', 'pending', v_tie_at);

  -- The BEFORE INSERT server-authoritative-timestamp trigger overrides the
  -- created_at above with clock_timestamp() (which also makes the two inserts
  -- non-equal). Force the identical ancient timestamp via UPDATE (no trigger on
  -- UPDATE) so this pair is genuinely the oldest-pending pair table-wide AND
  -- shares one timestamp, exercising the post_id tiebreak.
  UPDATE collective_reports SET created_at = v_tie_at
  WHERE post_id IN (v_post_low, v_post_high);

  PERFORM test_become_admin(v_admin);
  SELECT post_id INTO v_first_call FROM collective_moderation_queue(1);
  SELECT post_id INTO v_second_call FROM collective_moderation_queue(1);
  RESET ROLE;

  PERFORM tap_ok(v_first_call = v_post_low,        'equal oldest-pending timestamps break the tie by ascending post_id');
  PERFORM tap_ok(v_first_call = v_second_call,      'the tiebreak order is stable across repeated calls');
END $$;

-- ==========================================================================
-- I. page_size clamp -- floor 1, ceiling 100.
-- ==========================================================================
DO $$
DECLARE
  v_admin   UUID;
  v_owner   UUID;
  v_rep     UUID;
  v_post_a  UUID := gen_random_uuid();
  v_post_b  UUID := gen_random_uuid();
  v_floor_count   INT;
  v_ceiling_count INT;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post_a, v_owner, 'Clamp post A', 'clamp-post-a-body');
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post_b, v_owner, 'Clamp post B', 'clamp-post-b-body');

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post_a, v_rep, 'spam', 'pending');
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post_b, v_rep, 'spam', 'pending');

  -- Seed >100 additional distinct reported posts so the ceiling assertion
  -- below is non-tautological: with only a handful of pending posts total,
  -- LEAST(page_size, total_pending) and a real ceiling clamp of 100 both
  -- yield the same row count, so the assertion would pass whether or not
  -- the clamp exists. With well over 100 pending posts in play, only an
  -- actual server-side clamp caps the RPC's output at 100 rows.
  WITH bulk_posts AS (
    INSERT INTO collective_posts (id, user_id, title, body)
    SELECT gen_random_uuid(), v_owner, 'Clamp bulk post ' || g, 'clamp-bulk-body-' || g
    FROM generate_series(1, 110) AS g
    RETURNING id
  )
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  SELECT gen_random_uuid(), bp.id, v_rep, 'spam', 'pending'
  FROM bulk_posts bp;

  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_floor_count FROM collective_moderation_queue(0);
  SELECT COUNT(*) INTO v_ceiling_count FROM collective_moderation_queue(500);
  RESET ROLE;

  -- This DO block alone seeded 112 distinct pending posts (2 + 110 bulk), so
  -- the table-wide pending total is guaranteed to exceed the 100-row ceiling
  -- regardless of what earlier blocks seeded -- the assertion below is true
  -- only if the RPC actually clamps, not merely because too few rows exist.
  PERFORM tap_ok(v_floor_count = 1, 'page_size = 0 clamps up to a floor of 1 row');
  PERFORM tap_ok(
    v_ceiling_count = 100,
    'page_size = 500 clamps down to a ceiling of exactly 100 rows when more than 100 posts are pending'
  );

  -- Cleanup: the queue orders by oldest-pending-report first, so the 110
  -- bulk posts seeded above (their reports are now the oldest pending rows
  -- table-wide) would otherwise crowd out later blocks' fresh posts from the
  -- top-100 window of any subsequent collective_moderation_queue(100) call.
  -- Delete them now that this block's own assertions are done with them;
  -- ON DELETE CASCADE on collective_reports.post_id takes their reports too.
  DELETE FROM collective_posts WHERE title LIKE 'Clamp bulk post %';
END $$;

-- ==========================================================================
-- J. A reply (title IS NULL, non-null parent_post_id) with a pending report
--    is returned, with title = NULL.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_owner  UUID;
  v_rep    UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_exists BOOLEAN;
  v_title  TEXT;
  v_has_title BOOLEAN;
BEGIN
  v_admin := test_seed_user();
  v_owner := test_seed_user();
  v_rep   := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_owner, 'Reply parent', 'parent-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_owner, 'reply-body', v_top);

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_reply, v_rep, 'harassment', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT EXISTS(SELECT 1 FROM collective_moderation_queue(100) WHERE post_id = v_reply) INTO v_exists;
  SELECT title INTO v_title FROM collective_moderation_queue(100) WHERE post_id = v_reply;
  RESET ROLE;

  v_has_title := v_title IS NOT NULL;

  PERFORM tap_ok(v_exists, 'a reported reply is included in the queue (no parent_post_id filter)');
  PERFORM tap_ok(NOT v_has_title, 'a reported reply carries title = NULL');
END $$;

-- ==========================================================================
-- K. Co-occurring deletion state: is_user_deleted = TRUE AND author gone --
--    the row stays in the queue with a non-empty reports array.
-- ==========================================================================
DO $$
DECLARE
  v_admin  UUID;
  v_rep    UUID;
  v_post   UUID := gen_random_uuid();
  v_is_user_deleted BOOLEAN;
  v_author UUID;
  v_reports_len INT;
BEGIN
  v_admin := test_seed_user();
  v_rep   := test_seed_user();

  -- user_id NULL simulates the account-deletion FK ON DELETE SET NULL cascade;
  -- is_user_deleted TRUE simulates the content having also been self-deleted.
  INSERT INTO collective_posts (id, user_id, title, body, is_user_deleted, user_deleted_at)
  VALUES (v_post, NULL, 'Co-occurring deletion post', 'co-occurring-body', TRUE, NOW());

  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, status)
  VALUES (gen_random_uuid(), v_post, v_rep, 'spam', 'pending');

  PERFORM test_become_admin(v_admin);
  SELECT is_user_deleted, author_user_id, jsonb_array_length(reports)
  INTO v_is_user_deleted, v_author, v_reports_len
  FROM collective_moderation_queue(100) WHERE post_id = v_post;
  RESET ROLE;

  PERFORM tap_ok(v_is_user_deleted,        'a co-occurring self-deleted + account-gone post carries is_user_deleted = TRUE');
  PERFORM tap_ok(v_author IS NULL,         'a co-occurring self-deleted + account-gone post carries author_user_id = NULL');
  PERFORM tap_ok(v_reports_len >= 1,       'co-occurring deletion state does not drop the pending reports array');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
