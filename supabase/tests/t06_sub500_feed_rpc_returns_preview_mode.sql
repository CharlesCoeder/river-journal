-- t06: Sub-500 user calling collective_feed_page receives mode='preview' rows
-- and at most 4 rows total (1 most-recent + up to 3 teasers).
--
-- Red phase: FAILS because collective_feed_page does not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(3);

DO $$
DECLARE
  v_poster UUID;
  v_viewer UUID;
  v_total INT;
  v_preview INT;
BEGIN
  v_poster := test_seed_user();
  PERFORM test_seed_500_today(v_poster);
  PERFORM test_become(v_poster);
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p1');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p2');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p3');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p4');
  INSERT INTO collective_posts (id, user_id, body) VALUES (gen_random_uuid(), v_poster, 'p5');

  v_viewer := test_seed_user();
  PERFORM test_seed_sub500_today(v_viewer);
  PERFORM test_become(v_viewer);

  SELECT COUNT(*) INTO v_total   FROM collective_feed_page(NULL, 20);
  SELECT COUNT(*) INTO v_preview FROM collective_feed_page(NULL, 20) WHERE mode = 'preview';

  PERFORM ok(v_total >= 1,         'preview has at least one row');
  PERFORM ok(v_total <= 4,         'preview has at most 4 rows (1 + up to 3 teasers)');
  PERFORM ok(v_total = v_preview,  'every returned row has mode = preview');
END $$;

SELECT * FROM finish();
ROLLBACK;
