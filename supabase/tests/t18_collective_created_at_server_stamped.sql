-- t18: created_at on the public Collective tables is server-stamped on INSERT.
-- A client passing a bogus created_at (far past / far future) must have it
-- overwritten with now(), so feed ordering + keyset cursors can't be corrupted.
-- Covers collective_posts, collective_reactions, and collective_reports.

BEGIN;
\i _helpers.psql
SELECT plan(3);

DO $$
DECLARE
  v_uid   UUID;
  v_post  UUID := gen_random_uuid();
  v_rxn   UUID := gen_random_uuid();
  v_rpt   UUID := gen_random_uuid();
  v_bogus_past   TIMESTAMPTZ := '2019-01-01 00:00:00+00';
  v_bogus_future TIMESTAMPTZ := '2030-01-01 00:00:00+00';
  v_reporter UUID;
  v_post_created TIMESTAMPTZ;
  v_rxn_created  TIMESTAMPTZ;
  v_rpt_created  TIMESTAMPTZ;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);
  v_reporter := test_seed_user();
  PERFORM test_seed_500_today(v_reporter);

  -- Post: insert with a bogus backdated created_at.
  PERFORM test_become(v_uid);
  INSERT INTO collective_posts (id, user_id, title, body, created_at)
  VALUES (v_post, v_uid, 'Stamp title', 'stamp body', v_bogus_past);

  -- Reaction: insert with a bogus future created_at.
  INSERT INTO collective_reactions (id, post_id, user_id, kind, created_at)
  VALUES (v_rxn, v_post, v_uid, 'heart', v_bogus_future);

  -- Report: a different user reports the post with a bogus backdated created_at.
  PERFORM test_become(v_reporter);
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code, created_at)
  VALUES (v_rpt, v_post, v_reporter, 'spam', v_bogus_past);

  RESET ROLE;
  SELECT created_at INTO v_post_created FROM collective_posts     WHERE id = v_post;
  SELECT created_at INTO v_rxn_created  FROM collective_reactions WHERE id = v_rxn;
  SELECT created_at INTO v_rpt_created  FROM collective_reports   WHERE id = v_rpt;

  -- Assert each was stamped to ~now() (within a generous +/-1-minute window),
  -- i.e. the client-supplied bogus value was discarded. The window is two-sided
  -- because the server stamp uses clock_timestamp(), which runs microseconds
  -- AHEAD of the transaction-frozen NOW().
  PERFORM tap_ok(
    v_post_created BETWEEN NOW() - INTERVAL '1 minute' AND NOW() + INTERVAL '1 minute',
    'collective_posts.created_at server-stamped (client 2019 value ignored)'
  );
  PERFORM tap_ok(
    v_rxn_created BETWEEN NOW() - INTERVAL '1 minute' AND NOW() + INTERVAL '1 minute',
    'collective_reactions.created_at server-stamped (client 2030 value ignored)'
  );
  PERFORM tap_ok(
    v_rpt_created BETWEEN NOW() - INTERVAL '1 minute' AND NOW() + INTERVAL '1 minute',
    'collective_reports.created_at server-stamped (client 2019 value ignored)'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
