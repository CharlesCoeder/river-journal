-- t25: anon (unauthenticated) access is fully denied on both moderation
-- tables — SELECT and INSERT, on `moderation_actions` AND `user_suspensions`.
-- No anon policy exists on either table, and the belt-and-suspenders
-- REVOKE ALL ... FROM anon strips every grant, so each attempt must fail
-- with SQLSTATE 42501 / insufficient_privilege.
--
-- Activated once the moderation_actions / user_suspensions tables exist.

BEGIN;
\i _helpers.psql
SELECT plan(4);

DO $$
DECLARE
  v_owner_uid     UUID;
  v_action_id     UUID := gen_random_uuid();
  v_susp_id       UUID := gen_random_uuid();
  v_ma_select_blk BOOLEAN := FALSE;
  v_ma_insert_blk BOOLEAN := FALSE;
  v_us_select_blk BOOLEAN := FALSE;
  v_us_insert_blk BOOLEAN := FALSE;
  v_dummy         RECORD;
BEGIN
  v_owner_uid := test_seed_user();

  -- Seed one row on each table as the table owner (direct INSERT is blocked
  -- for every client role on both tables — see t23/t24's seeding note).
  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_action_id, v_owner_uid, 'add_note', v_owner_uid);
  INSERT INTO user_suspensions (id, user_id, kind, ends_at)
  VALUES (v_susp_id, v_owner_uid, 'post_react', NOW() + INTERVAL '1 day');

  PERFORM test_become_anon();

  -- anon SELECT on moderation_actions denied.
  BEGIN
    SELECT * INTO v_dummy FROM moderation_actions WHERE id = v_action_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_ma_select_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_ma_select_blk := TRUE; END IF;
  END;

  -- anon INSERT on moderation_actions denied.
  BEGIN
    INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
    VALUES (gen_random_uuid(), NULL, 'add_note', v_owner_uid);
  EXCEPTION
    WHEN insufficient_privilege THEN v_ma_insert_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_ma_insert_blk := TRUE; END IF;
  END;

  -- anon SELECT on user_suspensions denied.
  BEGIN
    SELECT * INTO v_dummy FROM user_suspensions WHERE id = v_susp_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_us_select_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_us_select_blk := TRUE; END IF;
  END;

  -- anon INSERT on user_suspensions denied.
  BEGIN
    INSERT INTO user_suspensions (id, user_id, kind, ends_at)
    VALUES (gen_random_uuid(), v_owner_uid, 'post_react', NOW() + INTERVAL '1 day');
  EXCEPTION
    WHEN insufficient_privilege THEN v_us_insert_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_us_insert_blk := TRUE; END IF;
  END;

  PERFORM tap_ok(v_ma_select_blk, 'anon SELECT on moderation_actions is denied');
  PERFORM tap_ok(v_ma_insert_blk, 'anon INSERT on moderation_actions is denied');
  PERFORM tap_ok(v_us_select_blk, 'anon SELECT on user_suspensions is denied');
  PERFORM tap_ok(v_us_insert_blk, 'anon INSERT on user_suspensions is denied');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
