-- t38: the AFTER INSERT trigger on moderation_actions that fires an async
-- notification call, and its non-blocking guarantee.
--
-- Coverage map:
--   A. trigger shape -- a trigger invoking notify_moderation_action_trigger()
--      exists on moderation_actions, is AFTER (not BEFORE/INSTEAD OF), fires
--      on INSERT, is FOR EACH ROW (not STATEMENT), and its WHEN clause
--      excludes action_type = 'add_note' (a private moderator note must never
--      trigger a user-facing notification).
--   B. trigger function hardening -- SECURITY DEFINER with a pinned
--      search_path (also swept generically by t11 across every DEFINER
--      function in public; asserted directly here too because this is the
--      function that reads/writes net.* and must not run with a mutable path).
--   C. the load-bearing non-blocking guarantee -- with pg_net FORCE-DROPPED
--      inside this test's own transaction (so the guard's absent-path is
--      exercised deterministically regardless of what the local Docker image
--      ships -- see the design notes on why a bare "call remove_post and assert
--      success" would otherwise only ever prove the present-path), invoking
--      remove_post and suspend_user as an admin still succeeds and their
--      audit rows still commit. The trigger's guard (pg_extension existence
--      check + EXCEPTION WHEN OTHERS around net.http_post) must swallow the
--      absence rather than letting an uncaught error in the AFTER trigger
--      abort and roll back the enclosing moderation transaction.
--
-- Red phase: notify_moderation_action_trigger() does not exist yet, so block
-- A's lookup returns no matching trigger and block B's lookup returns no
-- matching function -- both resolve to FALSE/NULL rather than raising (the
-- lookups are plain SELECTs, not calls into the missing function), so those
-- assertions fail cleanly. Block C calls the PRE-EXISTING remove_post /
-- suspend_user functions (shipped by an earlier migration) directly, which
-- succeed independently of whether this trigger exists -- those
-- specific assertions are expected to already read TRUE pre-implementation.
-- The suite as a whole still fails in red phase on blocks A and B; block C's
-- pre-existing-behavior assertions failing to move is not a false negative,
-- it is why blocks A/B are asserted explicitly rather than relying on C alone.

BEGIN;
\i _helpers.psql
SELECT plan(15);

-- ==========================================================================
-- A. Trigger shape: exists, AFTER, INSERT, ROW, WHEN excludes add_note.
-- ==========================================================================
DO $$
DECLARE
  v_trigger_name TEXT;
  v_timing       TEXT;
  v_manipulation TEXT;
  v_orientation  TEXT;
  v_condition    TEXT;
BEGIN
  SELECT t.tgname INTO v_trigger_name
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE p.proname = 'notify_moderation_action_trigger'
    AND t.tgrelid = 'public.moderation_actions'::regclass
    AND NOT t.tgisinternal
  LIMIT 1;

  PERFORM tap_ok(
    v_trigger_name IS NOT NULL,
    'a trigger invoking notify_moderation_action_trigger() exists on moderation_actions'
  );

  IF v_trigger_name IS NOT NULL THEN
    SELECT action_timing, event_manipulation, action_orientation, action_condition
    INTO v_timing, v_manipulation, v_orientation, v_condition
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'moderation_actions'
      AND trigger_name = v_trigger_name
    LIMIT 1;
  END IF;

  PERFORM tap_ok(COALESCE(v_timing = 'AFTER', FALSE), 'the trigger fires AFTER, not BEFORE/INSTEAD OF');
  PERFORM tap_ok(COALESCE(v_manipulation = 'INSERT', FALSE), 'the trigger fires on INSERT');
  PERFORM tap_ok(COALESCE(v_orientation = 'ROW', FALSE), 'the trigger is FOR EACH ROW, not STATEMENT');
  PERFORM tap_ok(
    COALESCE(v_condition ~* 'action_type', FALSE) AND COALESCE(v_condition ~* 'add_note', FALSE),
    'the trigger WHEN clause excludes add_note (references both action_type and add_note)'
  );
END $$;

-- ==========================================================================
-- B. Trigger function hardening: SECURITY DEFINER + pinned search_path.
-- ==========================================================================
DO $$
DECLARE
  v_is_definer BOOLEAN;
  v_pinned     BOOLEAN;
BEGIN
  SELECT
    p.prosecdef,
    EXISTS (SELECT 1 FROM unnest(p.proconfig) AS opt WHERE opt LIKE 'search_path=%')
  INTO v_is_definer, v_pinned
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'notify_moderation_action_trigger';

  PERFORM tap_ok(COALESCE(v_is_definer, FALSE), 'notify_moderation_action_trigger() is SECURITY DEFINER');
  PERFORM tap_ok(
    COALESCE(v_pinned, FALSE),
    'notify_moderation_action_trigger() pins a search_path (also swept generically by t11 across every DEFINER function)'
  );
END $$;

-- ==========================================================================
-- C. Non-blocking guarantee with pg_net force-dropped for this transaction.
-- ==========================================================================
DO $$
DECLARE
  v_dropped BOOLEAN := FALSE;
BEGIN
  -- Scoped to this pgTAP test transaction only: pgTAP wraps the whole file in
  -- BEGIN ... ROLLBACK, so this DROP is undone automatically once the file
  -- finishes and never affects other tests or a real environment. Forcing the
  -- drop (rather than trusting the local Docker image's ambient state) is
  -- what makes this deterministic -- pg_net is typically already installed
  -- locally, so without this DROP the guard's absent-path branch would never
  -- actually execute.
  BEGIN
    DROP EXTENSION IF EXISTS pg_net CASCADE;
    v_dropped := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_dropped := FALSE;
  END;

  PERFORM tap_ok(v_dropped, 'pg_net is force-dropped for this test transaction without error');
  PERFORM tap_ok(
    NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
    'pg_net is confirmed absent inside the test transaction (the guard''s absent-path is now reachable)'
  );
END $$;

DO $$
DECLARE
  v_admin        UUID;
  v_post_owner   UUID;
  v_post         UUID := gen_random_uuid();
  v_succeeded    BOOLEAN := FALSE;
  v_is_removed   BOOLEAN;
  v_action_count INT;
BEGIN
  v_admin      := test_seed_user();
  v_post_owner := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_post_owner, 'Non-blocking trigger probe (remove_post)', 'probe-body');

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM remove_post(v_post, 'spam', 'pg_net absent probe');
    v_succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_succeeded := FALSE;
  END;
  RESET ROLE;

  SELECT is_removed INTO v_is_removed FROM collective_posts WHERE id = v_post;
  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_post_id = v_post AND action_type = 'remove_post' AND actor_user_id = v_admin;

  PERFORM tap_ok(v_succeeded, 'remove_post succeeds even though pg_net is absent (trigger is best-effort, never raises)');
  PERFORM tap_ok(v_is_removed IS TRUE, 'the post-removal UPDATE commits even with pg_net absent');
  PERFORM tap_ok(v_action_count = 1, 'the moderation_actions audit row for remove_post commits even with pg_net absent');
END $$;

DO $$
DECLARE
  v_admin           UUID;
  v_target          UUID;
  v_succeeded       BOOLEAN := FALSE;
  v_suspension_count INT;
  v_action_count     INT;
BEGIN
  -- pg_net is still absent here: it was dropped earlier in this same test
  -- transaction, and pgTAP wraps the whole file in one BEGIN ... ROLLBACK.
  v_admin  := test_seed_user();
  v_target := test_seed_user();

  PERFORM test_become_admin(v_admin);
  BEGIN
    PERFORM suspend_user(v_target, 'post_react', 3, 'pg_net absent probe');
    v_succeeded := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_succeeded := FALSE;
  END;
  RESET ROLE;

  SELECT count(*) INTO v_suspension_count FROM user_suspensions WHERE user_id = v_target;
  SELECT count(*) INTO v_action_count
  FROM moderation_actions
  WHERE target_user_id = v_target AND action_type = 'suspend_user' AND actor_user_id = v_admin;

  PERFORM tap_ok(v_succeeded, 'suspend_user succeeds even though pg_net is absent (trigger is best-effort, never raises)');
  PERFORM tap_ok(v_suspension_count = 1, 'the user_suspensions insert commits even with pg_net absent');
  PERFORM tap_ok(v_action_count = 1, 'the moderation_actions audit row for suspend_user commits even with pg_net absent');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
