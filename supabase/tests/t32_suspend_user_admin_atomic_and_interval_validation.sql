-- t32: suspending a user, as an admin, atomically writes an active
-- suspension window and a matching audit-log entry, and invalid interval
-- input (zero or negative days) is rejected before anything is written.
--
-- Red phase: FAILS because suspend_user does not exist yet — the happy-path
-- call below is uncaught, so the whole assertion block errors out before
-- any tap_ok lines are emitted.

BEGIN;
\i _helpers.psql
SELECT plan(10);

DO $$
DECLARE
  v_admin               UUID;
  v_target              UUID;
  v_suspension_count    INT;
  v_starts_at           TIMESTAMPTZ;
  v_ends_at             TIMESTAMPTZ;
  v_active              BOOLEAN;
  v_action_count        INT;
  v_state               TEXT;
  v_rejected_zero       BOOLEAN := FALSE;
  v_rejected_negative   BOOLEAN := FALSE;
  v_rejected_kind       BOOLEAN := FALSE;
  v_rejected_null_days  BOOLEAN := FALSE;
  v_rejected_no_user    BOOLEAN := FALSE;
  v_count_after_invalid INT;
BEGIN
  v_admin  := test_seed_user();
  v_target := test_seed_user();

  PERFORM test_become_admin(v_admin);
  PERFORM suspend_user(v_target, 'post_react', 3, 'repeated low-effort reactions');

  RESET ROLE;
  SELECT count(*) INTO v_suspension_count FROM user_suspensions WHERE user_id = v_target;
  SELECT starts_at, ends_at INTO v_starts_at, v_ends_at
  FROM user_suspensions WHERE user_id = v_target;
  SELECT is_active_suspension(v_target, 'post_react') INTO v_active;

  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_user_id = v_target
    AND action_type = 'suspend_user'
    AND actor_user_id = v_admin
    AND (metadata ->> 'duration_days') = '3';

  PERFORM tap_ok(v_suspension_count = 1, 'admin suspension writes exactly one suspension row');
  PERFORM tap_ok(
    v_ends_at > v_starts_at
      AND v_ends_at BETWEEN v_starts_at + INTERVAL '2.9 days' AND v_starts_at + INTERVAL '3.1 days',
    'suspension window spans the requested duration'
  );
  PERFORM tap_ok(v_active IS TRUE, 'the suspended user is reported as actively suspended');
  PERFORM tap_ok(v_action_count = 1, 'exactly one audit-log entry captures the suspension with actor/duration metadata');

  PERFORM test_become_admin(v_admin);

  BEGIN
    PERFORM suspend_user(v_target, 'post_react', 0, 'zero-day probe');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_zero := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(v_target, 'post_react', -1, 'negative-day probe');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_negative := TRUE; END IF;
  END;

  PERFORM test_become_admin(v_admin);

  BEGIN
    PERFORM suspend_user(v_target, 'other_kind', 3, 'unsupported kind probe');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_kind := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(v_target, 'post_react', NULL, 'null-duration probe');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_null_days := TRUE; END IF;
  END;

  BEGIN
    PERFORM suspend_user(gen_random_uuid(), 'post_react', 3, 'nonexistent user probe');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '22023' THEN v_rejected_no_user := TRUE; END IF;
  END;

  RESET ROLE;
  SELECT count(*) INTO v_count_after_invalid FROM user_suspensions WHERE user_id = v_target;

  PERFORM tap_ok(v_rejected_zero,     'a zero-day suspension is rejected as invalid input');
  PERFORM tap_ok(v_rejected_negative, 'a negative-day suspension is rejected as invalid input');
  PERFORM tap_ok(v_count_after_invalid = 1, 'rejected suspension attempts write no additional row');
  PERFORM tap_ok(v_rejected_kind,      'an unsupported suspension kind is rejected as invalid input');
  PERFORM tap_ok(v_rejected_null_days, 'a NULL duration is rejected as invalid input');
  PERFORM tap_ok(v_rejected_no_user,   'suspending a nonexistent user is rejected as invalid input');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
