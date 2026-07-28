-- t26: the user_suspensions SELECT policy is admin-or-own. A user can read
-- their own suspension row but not another user's. The admin-claim positive
-- path cannot be exercised yet — no JWT carries `is_admin` until the
-- admin-claim milestone wires it; this test asserts the own-read path and the
-- cross-user denial, and defers the admin-positive assertion to that later
-- milestone.
--
-- Activated once the user_suspensions table exists.

BEGIN;
\i _helpers.psql
SELECT plan(2);

DO $$
DECLARE
  v_a             UUID;
  v_b             UUID;
  v_susp_a        UUID := gen_random_uuid();
  v_own_visible   INT;
  v_cross_visible INT;
BEGIN
  v_a := test_seed_user();
  v_b := test_seed_user();

  -- Seed A's suspension row as the table owner (direct INSERT is blocked for
  -- every client role — writes flow through the DEFINER moderation functions).
  INSERT INTO user_suspensions (id, user_id, kind, ends_at, reason)
  VALUES (v_susp_a, v_a, 'post_react', NOW() + INTERVAL '1 day', 'seed t26');

  -- A can see their own row.
  PERFORM test_become(v_a);
  SELECT COUNT(*) INTO v_own_visible FROM user_suspensions WHERE id = v_susp_a;
  PERFORM tap_ok(v_own_visible = 1, 'a user can SELECT their own user_suspensions row');

  -- B cannot see A's row (own-read policy filters it out; B is not an admin).
  PERFORM test_become(v_b);
  SELECT COUNT(*) INTO v_cross_visible FROM user_suspensions WHERE id = v_susp_a;
  PERFORM tap_ok(v_cross_visible = 0, 'a user cannot SELECT another user''s user_suspensions row');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
