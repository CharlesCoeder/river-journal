-- t09: delete_my_post atomically (a) sets body='[deleted]', (b) is_user_deleted=TRUE,
-- (c) user_deleted_at non-null, (d) cascades-delete reactions for that post.
--
-- Red phase: FAILS because delete_my_post + collective_posts + reactions
-- do not exist yet.

BEGIN;
\i _helpers.psql
SELECT plan(4);

DO $$
DECLARE
  v_a UUID;
  v_reactor UUID;
  v_post UUID := gen_random_uuid();
  v_body TEXT;
  v_deleted BOOLEAN;
  v_at TIMESTAMPTZ;
  v_react_count INT;
BEGIN
  v_a := test_seed_user();
  v_reactor := test_seed_user();
  PERFORM test_seed_500_today(v_a);
  PERFORM test_seed_500_today(v_reactor);

  PERFORM test_become(v_a);
  INSERT INTO collective_posts (id, user_id, body) VALUES (v_post, v_a, 'atomic-t09');

  PERFORM test_become(v_reactor);
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (gen_random_uuid(), v_post, v_reactor, 'heart');

  PERFORM test_become(v_a);
  PERFORM delete_my_post(v_post);

  RESET ROLE;
  SELECT body, is_user_deleted, user_deleted_at INTO v_body, v_deleted, v_at
  FROM collective_posts WHERE id = v_post;
  SELECT COUNT(*) INTO v_react_count
  FROM collective_reactions WHERE post_id = v_post;

  PERFORM tap_ok(v_body = '[deleted]',         'body replaced with [deleted]');
  PERFORM tap_ok(v_deleted IS TRUE,            'is_user_deleted = TRUE');
  PERFORM tap_ok(v_at IS NOT NULL,             'user_deleted_at populated');
  PERFORM tap_ok(v_react_count = 0,            'reactions deleted in same transaction');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
