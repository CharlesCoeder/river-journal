-- t54: the service role can actually read and write the service-role-internal
-- ledgers and logs.
--
-- moderation_notification_log, reply_notification_log, streak_reminder_log
-- and operational_health_log are all declared "service-role-internal only":
-- RLS enabled with NO policies, and REVOKE ALL FROM anon, authenticated. Their
-- migrations grant nothing to service_role explicitly — the writer path (the
-- trigger-invoked Edge Functions and pg_cron dispatchers) relies on Supabase's
-- default privileges (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
-- service_role) plus the role's BYPASSRLS attribute. That is the same posture
-- every service-role table in this schema uses, so it is not patched with a
-- per-table GRANT; instead this file pins the assumption. If a platform or
-- migration change ever strips those defaults, the first ledger claim would
-- fail with insufficient_privilege (42501) and every notification would 500
-- out-of-band — this suite fails first, in CI, with a readable message.
--
-- Coverage map:
--   A. role attribute — service_role carries BYPASSRLS, so "RLS enabled with
--      no policies" cannot lock the writer out.
--   B. grants — has_table_privilege(service_role, <table>, SELECT / INSERT)
--      is true for each of the four service-role-internal tables.
--   C. real writes — running AS service_role, the two notification ledgers'
--      claim write (INSERT ... ON CONFLICT DO NOTHING) lands one row each, and
--      the row is readable back under the same role.

BEGIN;
\i _helpers.psql
SELECT plan(11);

-- ==========================================================================
-- A. service_role bypasses RLS.
-- ==========================================================================
DO $$
DECLARE
  v_bypass BOOLEAN;
BEGIN
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'service_role';
  PERFORM tap_ok(
    COALESCE(v_bypass, FALSE),
    'service_role has BYPASSRLS (policy-less RLS on the ledgers cannot block the writer)'
  );
END;
$$;

-- ==========================================================================
-- B. Table privileges inherited from Supabase default privileges.
-- ==========================================================================
DO $$
DECLARE
  v_table TEXT;
  v_priv  TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'moderation_notification_log',
    'reply_notification_log',
    'streak_reminder_log',
    'operational_health_log'
  ] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      PERFORM tap_ok(
        has_table_privilege('service_role', format('public.%I', v_table), v_priv),
        format('service_role holds %s on %s', v_priv, v_table)
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ==========================================================================
-- C. The real claim writes succeed AS service_role.
-- ==========================================================================
DO $$
DECLARE
  v_admin       UUID;
  v_author      UUID;
  v_replier     UUID;
  v_action_id   UUID := gen_random_uuid();
  v_root_id     UUID := gen_random_uuid();
  v_reply_id    UUID := gen_random_uuid();
  v_mod_rows    INT;
  v_reply_rows  INT;
  v_mod_err     TEXT;
  v_reply_err   TEXT;
BEGIN
  -- FK targets, seeded as the table owner before switching role.
  v_admin   := test_seed_user();
  v_author  := test_seed_user_500();
  v_replier := test_seed_user_500();
  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_action_id, v_admin, 'add_note', v_author);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_root_id, v_author, 'root', 'root body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply_id, v_replier, 'reply body', v_root_id);

  -- Become the Edge Function's database identity. Each write is wrapped so a
  -- stripped grant surfaces as a readable `not ok` (with the SQLSTATE) instead
  -- of aborting the whole block.
  PERFORM set_config('role', 'service_role', true);

  BEGIN
    INSERT INTO moderation_notification_log (moderation_action_id)
    VALUES (v_action_id)
    ON CONFLICT (moderation_action_id) DO NOTHING;
    SELECT COUNT(*)::INT INTO v_mod_rows
    FROM moderation_notification_log WHERE moderation_action_id = v_action_id;
  EXCEPTION
    WHEN OTHERS THEN
      v_mod_rows := -1;
      v_mod_err  := SQLSTATE || ' ' || SQLERRM;
  END;

  BEGIN
    INSERT INTO reply_notification_log (reply_post_id)
    VALUES (v_reply_id)
    ON CONFLICT (reply_post_id) DO NOTHING;
    SELECT COUNT(*)::INT INTO v_reply_rows
    FROM reply_notification_log WHERE reply_post_id = v_reply_id;
  EXCEPTION
    WHEN OTHERS THEN
      v_reply_rows := -1;
      v_reply_err  := SQLSTATE || ' ' || SQLERRM;
  END;

  RESET ROLE;

  PERFORM tap_ok(
    v_mod_rows = 1,
    format('as service_role, the moderation_notification_log claim insert lands and reads back%s',
           COALESCE(' (' || v_mod_err || ')', ''))
  );
  PERFORM tap_ok(
    v_reply_rows = 1,
    format('as service_role, the reply_notification_log claim insert lands and reads back%s',
           COALESCE(' (' || v_reply_err || ')', ''))
  );
END;
$$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
