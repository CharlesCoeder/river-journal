-- t46: the reply-notification substrate -- thread_root_user_id's upward walk,
-- notify_reply_eligible_recipients' block + preference gate, the
-- reply_notification_log dedupe ledger, and the AFTER INSERT trigger's shape
-- + non-blocking guarantee.
--
-- Coverage map:
--   A. thread_root_user_id(post_id) -- upward WITH RECURSIVE walk of
--      parent_post_id to the root, returning the root's user_id: a
--      multi-level chain resolves to the top author; a post that is itself a
--      root returns its own author; a nonexistent post_id resolves to NULL;
--      an anonymized root (user_id already SET NULL) resolves to NULL; a
--      seeded parent cycle terminates AND resolves to NULL (never an
--      arbitrary cycle member's author, never a raise).
--   B. notify_reply_eligible_recipients(candidate_ids, replier_id) -- keeps
--      an enabled + unblocked candidate; drops a candidate blocked in EITHER
--      direction (seeded separately per direction); drops a candidate whose
--      reminders.replies.enabled is absent or explicitly false.
--   C. reply_notification_log -- the PK dedupe a claim-first idempotency
--      check relies on: a repeated ON CONFLICT DO NOTHING claim for the same
--      reply_post_id affects zero rows and leaves exactly one row.
--   D. The AFTER INSERT trigger -- exists, AFTER/INSERT/ROW, its WHEN clause
--      references parent_post_id (so a top-level post never fires it), its
--      function is SECURITY DEFINER with a pinned search_path, and the
--      non-blocking guarantee holds under two independent silent-skip
--      conditions: pg_net force-dropped (mirrors t38), and a half-configured
--      secret (edge_base_url GUC set, service_role_key GUC absent -- mirrors
--      the moderation trigger's Guard 2).
--   E. Access control -- authenticated cannot EXECUTE either new RPC and
--      cannot SELECT the ledger; anon cannot SELECT the ledger either
--      (service-role-only surfaces, SQLSTATE 42501).
--
-- Red phase: none of thread_root_user_id / notify_reply_eligible_recipients /
-- reply_notification_log / notify_reply_trigger exist yet, so the first
-- reference in block A raises "function ... does not exist" and the whole
-- file aborts before a single TAP line is emitted -- an unambiguous whole-
-- suite failure (mirrors t39's and t45's red-phase abort shape) until the
-- migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(23);

-- ==========================================================================
-- A. thread_root_user_id -- upward walk, root-given-root, NULL-safety, cycle.
-- ==========================================================================
DO $$
DECLARE
  v_root_author UUID;
  v_root        UUID := gen_random_uuid();
  v_mid_author  UUID;
  v_mid         UUID := gen_random_uuid();
  v_leaf_author UUID;
  v_leaf        UUID := gen_random_uuid();
  v_anon_root   UUID := gen_random_uuid();
  v_anon_child_author UUID;
  v_anon_child  UUID := gen_random_uuid();
  v_cycle_anchor UUID := gen_random_uuid();
  v_cycle_a     UUID := gen_random_uuid();
  v_cycle_b     UUID := gen_random_uuid();
  v_cycle_user  UUID;
  v_result      UUID;
BEGIN
  v_root_author := test_seed_user();
  v_mid_author  := test_seed_user();
  v_leaf_author := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root, v_root_author, 'Thread root for the upward-walk probe', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_mid, v_mid_author, 'mid-reply', v_root);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_leaf, v_leaf_author, 'leaf-reply', v_mid);

  -- (1) A three-level chain resolves all the way to the root author.
  SELECT thread_root_user_id(v_leaf) INTO v_result;
  PERFORM tap_ok(
    v_result = v_root_author,
    'thread_root_user_id walks a multi-level chain up to the root author'
  );

  -- (2) A post that is itself a root returns its own author.
  SELECT thread_root_user_id(v_root) INTO v_result;
  PERFORM tap_ok(
    v_result = v_root_author,
    'thread_root_user_id given a root post returns that post''s own author'
  );

  -- (3) A nonexistent post_id resolves to NULL, never a raise.
  SELECT thread_root_user_id(gen_random_uuid()) INTO v_result;
  PERFORM tap_ok(
    v_result IS NULL,
    'thread_root_user_id resolves to NULL for a nonexistent post_id'
  );

  -- (4) An anonymized root (user_id already SET NULL) resolves to NULL.
  v_anon_child_author := test_seed_user();
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_anon_root, test_seed_user(), 'Anonymized root probe', 'anon-root-body');
  UPDATE collective_posts SET user_id = NULL WHERE id = v_anon_root;
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_anon_child, v_anon_child_author, 'anon-child-reply', v_anon_root);

  SELECT thread_root_user_id(v_anon_child) INTO v_result;
  PERFORM tap_ok(
    v_result IS NULL,
    'thread_root_user_id resolves to NULL when the resolved root''s author has been anonymized'
  );

  -- (5) A seeded parent cycle terminates AND resolves to NULL -- never an
  -- arbitrary cycle member's author, never a hang, never a raise. A cycle has
  -- no NULL-parent root, so the CYCLE-guarded walk selects no root row.
  --
  -- Both cycle members must stay REPLIES (parent_post_id NOT NULL, title
  -- NULL) throughout to satisfy collective_posts_title_chk -- a top-level
  -- post requires a non-null title, so v_cycle_a is first seeded as a reply
  -- under a disposable anchor root, then repointed onto v_cycle_b to close
  -- the cycle (its parent_post_id is never NULL, so the CHECK never trips).
  v_cycle_user := test_seed_user();
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_cycle_anchor, v_cycle_user, 'Disposable anchor for the cycle fixture', 'anchor-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_cycle_a, v_cycle_user, 'cycle-a', v_cycle_anchor);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_cycle_b, v_cycle_user, 'cycle-b', v_cycle_a);
  UPDATE collective_posts SET parent_post_id = v_cycle_b WHERE id = v_cycle_a;

  SELECT thread_root_user_id(v_cycle_a) INTO v_result;
  PERFORM tap_ok(
    v_result IS NULL,
    'thread_root_user_id terminates on a seeded parent cycle and resolves to NULL, not an arbitrary cycle member''s author'
  );
END $$;

-- ==========================================================================
-- B. notify_reply_eligible_recipients -- block filter (both directions) +
--    the replies.enabled gate.
-- ==========================================================================
DO $$
DECLARE
  v_replier    UUID;
  v_candidate  UUID;
  v_kept       UUID;
BEGIN
  -- (6) Enabled + unblocked candidate is kept.
  v_replier   := test_seed_user();
  v_candidate := test_seed_user();
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('replies', jsonb_build_object('enabled', true))
  ) WHERE id = v_candidate;

  SELECT x INTO v_kept
  FROM notify_reply_eligible_recipients(ARRAY[v_candidate], v_replier) AS x;
  PERFORM tap_ok(
    v_kept = v_candidate,
    'an enabled, unblocked candidate survives notify_reply_eligible_recipients'
  );

  -- (7) Blocked in one direction (candidate blocks replier) is dropped.
  v_replier   := test_seed_user();
  v_candidate := test_seed_user();
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('replies', jsonb_build_object('enabled', true))
  ) WHERE id = v_candidate;
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_candidate, v_replier);

  PERFORM tap_ok(
    NOT EXISTS (
      SELECT 1 FROM notify_reply_eligible_recipients(ARRAY[v_candidate], v_replier) AS x WHERE x = v_candidate
    ),
    'a candidate who blocks the replier is dropped by notify_reply_eligible_recipients'
  );

  -- (8) Blocked in the other direction (replier blocks candidate) is also dropped.
  v_replier   := test_seed_user();
  v_candidate := test_seed_user();
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('replies', jsonb_build_object('enabled', true))
  ) WHERE id = v_candidate;
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_replier, v_candidate);

  PERFORM tap_ok(
    NOT EXISTS (
      SELECT 1 FROM notify_reply_eligible_recipients(ARRAY[v_candidate], v_replier) AS x WHERE x = v_candidate
    ),
    'a candidate blocked by the replier (opposite direction) is also dropped -- the filter is symmetric'
  );

  -- (9) reminders.replies.enabled entirely absent is a strict-gate exclusion.
  v_replier   := test_seed_user();
  v_candidate := test_seed_user();
  -- preferences stays '{}' from test_seed_user -- no reminders.replies object.

  PERFORM tap_ok(
    NOT EXISTS (
      SELECT 1 FROM notify_reply_eligible_recipients(ARRAY[v_candidate], v_replier) AS x WHERE x = v_candidate
    ),
    'a candidate with no reminders.replies preference object at all is excluded (strict gate)'
  );

  -- (10) reminders.replies.enabled explicitly false is excluded.
  v_replier   := test_seed_user();
  v_candidate := test_seed_user();
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('replies', jsonb_build_object('enabled', false))
  ) WHERE id = v_candidate;

  PERFORM tap_ok(
    NOT EXISTS (
      SELECT 1 FROM notify_reply_eligible_recipients(ARRAY[v_candidate], v_replier) AS x WHERE x = v_candidate
    ),
    'a candidate with reminders.replies.enabled = false is excluded'
  );
END $$;

-- ==========================================================================
-- C. reply_notification_log -- PK dedupe (double-claim = one row).
-- ==========================================================================
DO $$
DECLARE
  v_author      UUID;
  v_reply_post  UUID := gen_random_uuid();
  v_first_count INT;
  v_second_rowcount INT;
  v_after_count INT;
BEGIN
  v_author := test_seed_user();
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_reply_post, v_author, 'Ledger dedupe probe (top-level stand-in)', 'ledger-probe-body');

  INSERT INTO reply_notification_log (reply_post_id) VALUES (v_reply_post)
  ON CONFLICT (reply_post_id) DO NOTHING;
  SELECT count(*) INTO v_first_count FROM reply_notification_log WHERE reply_post_id = v_reply_post;
  PERFORM tap_ok(v_first_count = 1, 'the first insert-first dedupe claim lands exactly one ledger row');

  INSERT INTO reply_notification_log (reply_post_id) VALUES (v_reply_post)
  ON CONFLICT (reply_post_id) DO NOTHING;
  GET DIAGNOSTICS v_second_rowcount = ROW_COUNT;
  SELECT count(*) INTO v_after_count FROM reply_notification_log WHERE reply_post_id = v_reply_post;

  PERFORM tap_ok(
    v_second_rowcount = 0 AND v_after_count = 1,
    'a repeated ON CONFLICT DO NOTHING claim for the same reply_post_id affects zero rows, leaving exactly one'
  );
END $$;

-- ==========================================================================
-- D. Trigger shape + non-blocking guarantee.
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
  WHERE p.proname = 'notify_reply_trigger'
    AND t.tgrelid = 'public.collective_posts'::regclass
    AND NOT t.tgisinternal
  LIMIT 1;

  PERFORM tap_ok(
    v_trigger_name IS NOT NULL,
    'a trigger invoking notify_reply_trigger() exists on collective_posts'
  );

  IF v_trigger_name IS NOT NULL THEN
    SELECT action_timing, event_manipulation, action_orientation, action_condition
    INTO v_timing, v_manipulation, v_orientation, v_condition
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table = 'collective_posts'
      AND trigger_name = v_trigger_name
    LIMIT 1;
  END IF;

  PERFORM tap_ok(
    COALESCE(v_timing = 'AFTER' AND v_manipulation = 'INSERT' AND v_orientation = 'ROW', FALSE),
    'the trigger fires AFTER INSERT FOR EACH ROW'
  );
  PERFORM tap_ok(
    COALESCE(v_condition ~* 'parent_post_id', FALSE),
    'the trigger WHEN clause references parent_post_id, so a top-level post never fires it'
  );
END $$;

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
    AND p.proname = 'notify_reply_trigger';

  PERFORM tap_ok(
    COALESCE(v_is_definer, FALSE) AND COALESCE(v_pinned, FALSE),
    'notify_reply_trigger() is SECURITY DEFINER with a pinned search_path (also swept generically by t11)'
  );
END $$;

DO $$
DECLARE
  v_dropped   BOOLEAN := FALSE;
  v_author    UUID;
  v_root      UUID := gen_random_uuid();
  v_reply     UUID := gen_random_uuid();
  v_committed BOOLEAN;
BEGIN
  -- Force pg_net absent for this test transaction (pgTAP wraps the whole file
  -- in BEGIN ... ROLLBACK, so this is undone automatically and never affects
  -- other tests or a real environment). Without forcing this, the guard's
  -- absent-path branch would never actually execute against a local Docker
  -- image that ships pg_net pre-installed.
  BEGIN
    DROP EXTENSION IF EXISTS pg_net CASCADE;
    v_dropped := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_dropped := FALSE;
  END;

  v_author := test_seed_user();
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root, v_author, 'Non-blocking trigger probe (pg_net absent)', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, test_seed_user(), 'reply-body-pg-net-absent', v_root);

  SELECT EXISTS(SELECT 1 FROM collective_posts WHERE id = v_reply) INTO v_committed;

  PERFORM tap_ok(v_dropped, 'pg_net is force-dropped for this test transaction without error');
  PERFORM tap_ok(
    v_committed,
    'a reply INSERT commits even though pg_net is absent (the trigger is best-effort and never raises)'
  );
END $$;

DO $$
DECLARE
  v_recreated BOOLEAN := FALSE;
  v_author    UUID;
  v_root      UUID := gen_random_uuid();
  v_reply     UUID := gen_random_uuid();
  v_committed BOOLEAN;
BEGIN
  -- Re-install pg_net (dropped by the previous DO block, still in this same
  -- pgTAP transaction) so this case genuinely exercises the both-present
  -- secret guard rather than short-circuiting on the earlier pg_net-absent
  -- guard. Only edge_base_url resolves (GUC fallback); service_role_key is
  -- left unset -- a half-configured environment.
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
    v_recreated := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_recreated := FALSE;
  END;

  PERFORM set_config('app.settings.edge_base_url', 'http://localhost:54321', true);
  -- app.settings.service_role_key is deliberately left unset for this test.

  v_author := test_seed_user();
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root, v_author, 'Non-blocking trigger probe (half-configured secret)', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, test_seed_user(), 'reply-body-half-configured-secret', v_root);

  SELECT EXISTS(SELECT 1 FROM collective_posts WHERE id = v_reply) INTO v_committed;

  PERFORM tap_ok(
    v_committed,
    'a reply INSERT commits when only edge_base_url resolves and service_role_key does not (half-configured secret, both-present guard skips silently)'
  );
END $$;

-- ==========================================================================
-- E. Access control -- service-role-only surfaces.
-- ==========================================================================
DO $$
DECLARE
  v_user   UUID;
  v_denied BOOLEAN;
  v_state  TEXT;
BEGIN
  v_user := test_seed_user();
  PERFORM test_become(v_user);

  -- (18) authenticated cannot EXECUTE thread_root_user_id.
  v_denied := FALSE;
  BEGIN
    PERFORM thread_root_user_id(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE thread_root_user_id (service-role only)');

  -- (19) authenticated cannot EXECUTE notify_reply_eligible_recipients.
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM notify_reply_eligible_recipients(ARRAY[v_user], v_user);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE notify_reply_eligible_recipients (service-role only)');

  -- (20) authenticated cannot SELECT the ledger.
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM reply_notification_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot SELECT reply_notification_log (service-role only, no grants)');

  -- (21) anon cannot SELECT the ledger.
  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM reply_notification_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'anon cannot SELECT reply_notification_log (service-role only, no grants)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
