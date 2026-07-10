-- t21: The daily gate resets every writing day — yesterday's 500 words do NOT
-- carry over to unlock today.
--
-- Every other seed helper pins the qualifying flow to today's UTC date, so no
-- existing test exercises the day-boundary. Here the viewer's ONLY qualifying
-- flow is dated to YESTERDAY: with nothing written today the gate must read
-- FALSE (deny posting, serve preview). Then, after the SAME user writes a
-- today-dated 500-word flow, the gate must re-evaluate to TRUE (full feed) —
-- proving the reset is a live property of the predicate, not a persisted
-- "unlocked" flag that would leak across days.
--
-- Seeded users default to users.timezone = 'UTC', so "local today" == "UTC
-- today"; yesterday/today are computed as the UTC date and UTC date - 1 to
-- stay consistent with that timezone.

BEGIN;
\i _helpers.psql
SELECT plan(6);

DO $$
DECLARE
  v_poster    UUID;
  v_viewer    UUID;
  v_today     DATE := (NOW() AT TIME ZONE 'UTC')::date;
  v_yesterday DATE := (NOW() AT TIME ZONE 'UTC')::date - 1;
  v_gate      BOOLEAN;
  v_blocked   BOOLEAN := FALSE;
  v_full      INT;
  v_preview   INT;
BEGIN
  -- A qualifying poster seeds top-level posts so the preview branch has rows to
  -- return (otherwise the preview-mode assertion would be vacuous). Mirrors the
  -- two-user setup in t06.
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (gen_random_uuid(), v_poster, 'Poster title 1', 'poster-row-1');
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (gen_random_uuid(), v_poster, 'Poster title 2', 'poster-row-2');

  -- The viewer's only qualifying flow is YESTERDAY's — nothing today.
  v_viewer := test_seed_user();
  PERFORM test_seed_words_on_date(v_viewer, v_yesterday, 500);
  PERFORM test_become(v_viewer);

  -- (a) Yesterday's 500 must NOT count toward today's gate.
  v_gate := daily_500_completed_today(v_viewer);
  PERFORM tap_ok(v_gate = FALSE, 'yesterday-only 500 leaves today gate closed (predicate FALSE)');

  -- (b) A user whose only qualifying flow is yesterday's is RLS-denied posting
  -- today. Supply a valid title so the ONLY reason to deny is the 500-gate.
  BEGIN
    INSERT INTO collective_posts (id, user_id, title, body)
    VALUES (gen_random_uuid(), v_viewer, 'Should not land t21', 'should-not-land-t21');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blocked := TRUE;
    WHEN check_violation       THEN v_blocked := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blocked := TRUE; END IF;
  END;
  PERFORM tap_ok(v_blocked, 'yesterday-only 500 user INSERT today is RLS-denied');

  -- (c) The feed serves preview, not full, to the still-locked viewer.
  SELECT COUNT(*) INTO v_full    FROM collective_feed_page(NULL, 20) WHERE mode = 'full';
  SELECT COUNT(*) INTO v_preview FROM collective_feed_page(NULL, 20) WHERE mode = 'preview';
  PERFORM tap_ok(v_full = 0,    'locked viewer feed has zero full-mode rows');
  PERFORM tap_ok(v_preview > 0, 'locked viewer feed returns preview-mode rows (non-vacuous)');

  -- Now the SAME viewer writes a today-dated 500-word flow.
  PERFORM test_seed_words_on_date(v_viewer, v_today, 500);

  -- (d) The gate re-evaluates live to TRUE — no persisted unlock needed, and
  -- the fresh SELECT observes the just-written flow (predicate is STABLE, each
  -- call re-executes).
  v_gate := daily_500_completed_today(v_viewer);
  PERFORM tap_ok(v_gate = TRUE, 'writing 500 today re-opens the gate for the same user (predicate TRUE)');

  -- (e) The feed now serves full mode.
  SELECT COUNT(*) INTO v_full FROM collective_feed_page(NULL, 20) WHERE mode = 'full';
  PERFORM tap_ok(v_full > 0, 'unlocked viewer feed returns full-mode rows');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
