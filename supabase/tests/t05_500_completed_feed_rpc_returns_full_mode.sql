-- t05: 500-completed user calling collective_feed_page returns mode='full'
-- on every row.
--
-- Red phase: FAILS because collective_feed_page does not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(2);

DO $$
DECLARE
  v_uid UUID;
  v_total INT;
  v_full INT;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);

  -- Seed two posts so the feed has rows to return.
  PERFORM test_become(v_uid);
  INSERT INTO collective_posts (id, user_id, body)
  VALUES (gen_random_uuid(), v_uid, 'feed-row-1');
  INSERT INTO collective_posts (id, user_id, body)
  VALUES (gen_random_uuid(), v_uid, 'feed-row-2');

  SELECT COUNT(*) INTO v_total FROM collective_feed_page(NULL, 20);
  SELECT COUNT(*) INTO v_full  FROM collective_feed_page(NULL, 20) WHERE mode = 'full';

  PERFORM ok(v_total >= 2, 'collective_feed_page returns at least the seeded rows');
  PERFORM ok(v_total = v_full, 'every returned row has mode = full');
END $$;

SELECT * FROM finish();
ROLLBACK;
