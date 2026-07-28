-- t23: moderation_actions is a permanently append-only audit log. UPDATE and
-- DELETE must be denied for every non-owner role that could reach the table
-- directly: `authenticated` (the primary client case) and `anon` (the "any
-- non-owner role" clause, complementing t25's anon SELECT/INSERT coverage).
-- No UPDATE/DELETE policy is ever created, and the belt-and-suspenders
-- REVOKE/GRANT only grants SELECT to `authenticated` — so every attempt here
-- must fail at the GRANT or RLS layer with SQLSTATE 42501 /
-- insufficient_privilege.
--
-- Activated once the moderation_actions table exists.

BEGIN;
\i _helpers.psql
SELECT plan(4);

DO $$
DECLARE
  v_actor        UUID;
  v_other        UUID;
  v_row_id       UUID := gen_random_uuid();
  v_auth_upd_blk BOOLEAN := FALSE;
  v_auth_del_blk BOOLEAN := FALSE;
  v_anon_upd_blk BOOLEAN := FALSE;
  v_anon_del_blk BOOLEAN := FALSE;
BEGIN
  v_actor := test_seed_user();
  v_other := test_seed_user();

  -- Seed the audit row as the table owner. The test harness session starts
  -- in the owner role before any test_become(...) call, and direct INSERT
  -- is blocked for every client role — so this is the only path in for a
  -- fixture row.
  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id, note)
  VALUES (v_row_id, v_actor, 'add_note', v_other, 'seed note t23');

  -- authenticated UPDATE denied.
  PERFORM test_become(v_other);
  BEGIN
    UPDATE moderation_actions SET note = 'tampered' WHERE id = v_row_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_auth_upd_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_auth_upd_blk := TRUE; END IF;
  END;

  -- authenticated DELETE denied.
  BEGIN
    DELETE FROM moderation_actions WHERE id = v_row_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_auth_del_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_auth_del_blk := TRUE; END IF;
  END;

  -- anon UPDATE denied.
  PERFORM test_become_anon();
  BEGIN
    UPDATE moderation_actions SET note = 'tampered-anon' WHERE id = v_row_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_upd_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_upd_blk := TRUE; END IF;
  END;

  -- anon DELETE denied.
  BEGIN
    DELETE FROM moderation_actions WHERE id = v_row_id;
  EXCEPTION
    WHEN insufficient_privilege THEN v_anon_del_blk := TRUE;
    WHEN OTHERS THEN
      IF SQLSTATE = '42501' THEN v_anon_del_blk := TRUE; END IF;
  END;

  PERFORM tap_ok(v_auth_upd_blk, 'authenticated UPDATE on moderation_actions is denied (append-only audit log)');
  PERFORM tap_ok(v_auth_del_blk, 'authenticated DELETE on moderation_actions is denied (append-only audit log)');
  PERFORM tap_ok(v_anon_upd_blk, 'anon UPDATE on moderation_actions is denied (append-only audit log)');
  PERFORM tap_ok(v_anon_del_blk, 'anon DELETE on moderation_actions is denied (append-only audit log)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
