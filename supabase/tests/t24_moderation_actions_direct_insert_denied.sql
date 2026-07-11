-- t24: direct INSERT into moderation_actions as a non-admin `authenticated`
-- user is denied. No INSERT policy is ever created for this table — the only
-- write path is the SECURITY DEFINER moderation functions (added in a later
-- milestone), which run as the table owner. A plain authenticated client
-- attempting to write directly must fail with SQLSTATE 42501.
--
-- Activated once the moderation_actions table exists.

BEGIN;
\i _helpers.psql
SELECT plan(1);

DO $$
DECLARE
  v_uid     UUID;
  v_blocked BOOLEAN := FALSE;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_become(v_uid);

  BEGIN
    INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
    VALUES (gen_random_uuid(), v_uid, 'add_note', v_uid);
  EXCEPTION
    WHEN insufficient_privilege THEN v_blocked := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_blocked := TRUE; END IF;
  END;

  PERFORM tap_ok(v_blocked, 'direct INSERT into moderation_actions by a non-admin authenticated user is denied');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
