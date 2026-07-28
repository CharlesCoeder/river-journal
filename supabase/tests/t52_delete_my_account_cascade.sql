-- t52: delete_my_account -- the SECURITY DEFINER cascade RPC that
-- soft-anonymizes Collective contributions and hard-deletes private/
-- operational data for a self-service account deletion, plus
-- complete_pending_account_deletions() -- the daily retry sweep that finishes
-- any deletion an Edge Function invocation crashed mid-saga on.
--
-- Coverage map:
--   A. Cascade correctness -- a single user seeded with a row in every
--      affected table (incl. a second user for BOTH-direction user_blocks,
--      and a moderation_actions row where the deleted user is the TARGET
--      rather than the actor, to pin that the RPC touches ONLY the actor
--      field):
--        1.  collective_posts.user_id -> NULL, body retained (soft-anonymize).
--        2.  collective_reactions.user_id -> NULL (soft-anonymize).
--        3.  moderation_actions.actor_user_id -> NULL, action_type retained
--            (audit row survives; soft-anonymize the actor).
--        4.  moderation_actions.target_user_id is UNCHANGED when the deleted
--            user is the TARGET, not the actor -- the RPC's explicit UPDATE
--            only touches actor_user_id.
--        5.  collective_reports (as reporter) hard-deleted.
--        6.  user_push_tokens hard-deleted.
--        7.  user_grace_days hard-deleted.
--        8.  user_suspensions (an ACTIVE suspension) hard-deleted.
--        9.  subscription_receipts hard-deleted.
--        10. trusted_browsers hard-deleted.
--        11. user_blocks hard-deleted as BLOCKER.
--        12. user_blocks hard-deleted as BLOCKED (a second user's block
--            naming the deleted user) -- the both-directions gap fix.
--        13. daily_entries hard-deleted.
--        14. flows hard-deleted (cascades via daily_entries).
--        15. the users row SURVIVES with deletion_requested_at set (the
--            partial-state marker).
--        16. auth.users is UNTOUCHED by this RPC (removed only by the Edge
--            wrapper's admin call / the sweep, never by this function).
--   B. Idempotency -- re-running the RPC on an already-cascaded user is a
--      harmless no-op (no error, marker unchanged).
--   C. EXECUTE is denied to authenticated/anon (SQLSTATE 42501).
--   D. deletion_requested_at is server-write-only: authenticated is denied
--      the effective UPDATE and INSERT privilege on the column (mirrors the
--      subscription_tier single-column check in t49; the dynamic allow-list
--      completeness assertion lives in t50).
--   E. FK-coverage guard (schema-drift resilience) -- every FK referencing
--      public.users or auth.users is ON DELETE CASCADE or SET NULL, so a
--      future unhandled RESTRICT/NO ACTION FK fails this test loudly instead
--      of silently stranding a deletion.
--   F. Both cascade functions pin a search_path.
--   G. complete_pending_account_deletions(): EXECUTE denied to
--      authenticated/anon; a grace-window user (< 1 hour) is left untouched;
--      two OLD-marked users (> 1 hour) are BOTH fully removed (public.users +
--      auth.users) in a single sweep invocation -- batch correctness, the
--      per-row isolation the migration's BEGIN/EXCEPTION block provides must
--      never stop the sweep short of a healthy row. Plus the UN-CANCELLED-
--      BILLING GATE: an OLD-marked user who STILL has a live Stripe receipt
--      (status active/past_due/pending) is NOT cascaded/auth-deleted by the
--      sweep and the receipt is preserved (so a later Edge retry can still
--      cancel with the provider) -- 'pending'/incomplete gates too, since Phase
--      A now cancels it and it can still activate + bill -- while an OLD-marked
--      user with no live Stripe receipt -- or only an apple/play receipt, which
--      is cancelled natively and must not gate -- IS finalized.
--   H. auth.users DELETE privilege smoke-assertion -- the role that owns
--      these SECURITY DEFINER functions can directly DELETE FROM auth.users
--      (the sweep's finalizer relies on this raw SQL privilege, since a
--      pg_cron-invoked function cannot call the GoTrue admin API).
--
-- Author it even if Docker is unavailable in this environment (t51's
-- precedent) -- it auto-discovers on the next `yarn parity:db` /
-- `yarn test:migrations` run once the migration lands.
--
-- Red phase: delete_my_account() and complete_pending_account_deletions() do
-- not exist yet, and users.deletion_requested_at does not exist yet, so the
-- first reference to any of them raises "does not exist" and the whole file
-- aborts with no TAP output -- an unambiguous suite failure until the
-- migration lands. Blocks C/D/E/F/G/H that probe pg_proc/pg_constraint/
-- information_schema directly (rather than calling the functions) degrade to
-- failing tap_ok calls instead of aborting.

BEGIN;
\i _helpers.psql
SELECT plan(32);

-- ==========================================================================
-- A. Cascade correctness -- one user seeded with a row in every affected
--    table, one RPC call, sixteen assertions.
-- ==========================================================================
DO $$
DECLARE
  v_user            UUID;
  v_second          UUID;
  v_admin           UUID;
  v_post            UUID := gen_random_uuid();
  v_reaction        UUID := gen_random_uuid();
  v_mod_actor_row   UUID := gen_random_uuid();
  v_mod_target_row  UUID := gen_random_uuid();
  v_report          UUID := gen_random_uuid();
  v_push_token      UUID := gen_random_uuid();
  v_grace_day       UUID := gen_random_uuid();
  v_suspension      UUID := gen_random_uuid();
  v_receipt         UUID := gen_random_uuid();
  v_trusted_browser UUID := gen_random_uuid();
  v_block_out       UUID := gen_random_uuid();
  v_block_in        UUID := gen_random_uuid();
  v_entry_id        UUID;

  v_post_user_id       UUID;
  v_post_body          TEXT;
  v_reaction_user_id   UUID;
  v_mod_actor_after     UUID;
  v_mod_action_type     TEXT;
  v_mod_target_after    UUID;
  v_report_count        INT;
  v_push_token_count    INT;
  v_grace_day_count     INT;
  v_suspension_count    INT;
  v_receipt_count       INT;
  v_trusted_browser_cnt INT;
  v_block_out_count     INT;
  v_block_in_count      INT;
  v_daily_entry_count   INT;
  v_flow_count          INT;
  v_users_row_exists    BOOLEAN;
  v_deletion_marker     TIMESTAMPTZ;
  v_auth_users_exists   BOOLEAN;
BEGIN
  v_user   := test_seed_user();
  v_second := test_seed_user();
  v_admin  := test_seed_user();

  -- Collective contributions (soft-anonymize target).
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_user, 'Keep this title', 'keep-this-body');
  INSERT INTO collective_reactions (id, post_id, user_id, kind)
  VALUES (v_reaction, v_post, v_user, 'heart');

  -- Moderation: one row where the deleted user is the ACTOR, one where they
  -- are the TARGET (a DIFFERENT actor -- the admin).
  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_mod_actor_row, v_user, 'add_note', v_second);
  INSERT INTO moderation_actions (id, actor_user_id, action_type, target_user_id)
  VALUES (v_mod_target_row, v_admin, 'suspend_user', v_user);

  -- Private / operational data (hard-delete targets).
  INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code)
  VALUES (v_report, v_post, v_user, 'spam');
  INSERT INTO user_push_tokens (id, user_id, expo_push_token, platform)
  VALUES (v_push_token, v_user, 'ExponentPushToken[cascade-test]', 'ios');
  INSERT INTO user_grace_days (id, user_id, earned_for_milestone)
  VALUES (v_grace_day, v_user, 7);
  INSERT INTO user_suspensions (id, user_id, kind, ends_at, reason)
  VALUES (v_suspension, v_user, 'post_react', NOW() + INTERVAL '3 days', 'cascade test');
  INSERT INTO subscription_receipts
    (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (v_receipt, v_user, 'stripe', 'sub_cascade_test', 'active', NOW() + INTERVAL '10 days');
  INSERT INTO trusted_browsers (id, user_id, device_token_hash)
  VALUES (v_trusted_browser, v_user, 'cascade-test-hash');

  -- user_blocks in BOTH directions.
  INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id)
  VALUES (v_block_out, v_user, v_second);
  INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id)
  VALUES (v_block_in, v_second, v_user);

  -- daily_entries + flows.
  PERFORM test_seed_500_today(v_user);
  SELECT id INTO v_entry_id FROM daily_entries WHERE user_id = v_user;

  -- ── Run the cascade ──────────────────────────────────────────────────
  PERFORM delete_my_account(v_user);

  -- (1) collective_posts soft-anonymized.
  SELECT user_id, body INTO v_post_user_id, v_post_body FROM collective_posts WHERE id = v_post;
  PERFORM tap_ok(
    v_post_user_id IS NULL AND v_post_body = 'keep-this-body',
    'collective_posts.user_id is soft-anonymized (NULL) and the body is retained'
  );

  -- (2) collective_reactions soft-anonymized.
  SELECT user_id INTO v_reaction_user_id FROM collective_reactions WHERE id = v_reaction;
  PERFORM tap_ok(v_reaction_user_id IS NULL, 'collective_reactions.user_id is soft-anonymized (NULL)');

  -- (3) moderation_actions: actor row anonymized, action_type retained.
  SELECT actor_user_id, action_type INTO v_mod_actor_after, v_mod_action_type
  FROM moderation_actions WHERE id = v_mod_actor_row;
  PERFORM tap_ok(
    v_mod_actor_after IS NULL AND v_mod_action_type = 'add_note',
    'moderation_actions.actor_user_id is soft-anonymized (NULL) and action_type + the row survive'
  );

  -- (4) moderation_actions: target-only row is UNCHANGED (RPC touches actor only).
  SELECT target_user_id INTO v_mod_target_after FROM moderation_actions WHERE id = v_mod_target_row;
  PERFORM tap_ok(
    v_mod_target_after = v_user,
    'moderation_actions.target_user_id is left UNCHANGED when the deleted user is only the target, not the actor'
  );

  -- (5) collective_reports hard-deleted.
  SELECT COUNT(*) INTO v_report_count FROM collective_reports WHERE id = v_report;
  PERFORM tap_ok(v_report_count = 0, 'collective_reports (as reporter) is hard-deleted');

  -- (6) user_push_tokens hard-deleted.
  SELECT COUNT(*) INTO v_push_token_count FROM user_push_tokens WHERE id = v_push_token;
  PERFORM tap_ok(v_push_token_count = 0, 'user_push_tokens is hard-deleted');

  -- (7) user_grace_days hard-deleted.
  SELECT COUNT(*) INTO v_grace_day_count FROM user_grace_days WHERE id = v_grace_day;
  PERFORM tap_ok(v_grace_day_count = 0, 'user_grace_days is hard-deleted');

  -- (8) user_suspensions (ACTIVE) hard-deleted -- deletion proceeds despite
  -- an open suspension (data-rights are unconditional).
  SELECT COUNT(*) INTO v_suspension_count FROM user_suspensions WHERE id = v_suspension;
  PERFORM tap_ok(v_suspension_count = 0, 'user_suspensions (an ACTIVE suspension) is hard-deleted');

  -- (9) subscription_receipts hard-deleted.
  SELECT COUNT(*) INTO v_receipt_count FROM subscription_receipts WHERE id = v_receipt;
  PERFORM tap_ok(v_receipt_count = 0, 'subscription_receipts is hard-deleted');

  -- (10) trusted_browsers hard-deleted.
  SELECT COUNT(*) INTO v_trusted_browser_cnt FROM trusted_browsers WHERE id = v_trusted_browser;
  PERFORM tap_ok(v_trusted_browser_cnt = 0, 'trusted_browsers is hard-deleted');

  -- (11) user_blocks hard-deleted as blocker.
  SELECT COUNT(*) INTO v_block_out_count FROM user_blocks WHERE id = v_block_out;
  PERFORM tap_ok(v_block_out_count = 0, 'user_blocks is hard-deleted in the BLOCKER direction');

  -- (12) user_blocks hard-deleted as blocked.
  SELECT COUNT(*) INTO v_block_in_count FROM user_blocks WHERE id = v_block_in;
  PERFORM tap_ok(v_block_in_count = 0, 'user_blocks is hard-deleted in the BLOCKED direction (both-directions fix)');

  -- (13) daily_entries hard-deleted.
  SELECT COUNT(*) INTO v_daily_entry_count FROM daily_entries WHERE id = v_entry_id;
  PERFORM tap_ok(v_daily_entry_count = 0, 'daily_entries is hard-deleted');

  -- (14) flows hard-deleted (cascades via daily_entries).
  SELECT COUNT(*) INTO v_flow_count FROM flows WHERE daily_entry_id = v_entry_id;
  PERFORM tap_ok(v_flow_count = 0, 'flows is hard-deleted (cascades via daily_entries)');

  -- (15) users row survives with the marker set.
  SELECT EXISTS(SELECT 1 FROM users WHERE id = v_user) INTO v_users_row_exists;
  SELECT deletion_requested_at INTO v_deletion_marker FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_users_row_exists AND v_deletion_marker IS NOT NULL,
    'the users row survives the RPC with deletion_requested_at set (the partial-state marker)'
  );

  -- (16) auth.users is untouched by this RPC.
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user) INTO v_auth_users_exists;
  PERFORM tap_ok(v_auth_users_exists, 'auth.users is UNTOUCHED by delete_my_account (removed only by the Edge wrapper / sweep)');
END $$;

-- ==========================================================================
-- B. Idempotency -- re-running on an already-cascaded user is a no-op.
-- ==========================================================================
DO $$
DECLARE
  v_user          UUID;
  v_marker_before TIMESTAMPTZ;
  v_marker_after  TIMESTAMPTZ;
  v_ran_clean     BOOLEAN := FALSE;
BEGIN
  v_user := test_seed_user();
  PERFORM delete_my_account(v_user);
  SELECT deletion_requested_at INTO v_marker_before FROM users WHERE id = v_user;

  BEGIN
    PERFORM delete_my_account(v_user);
    v_ran_clean := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_ran_clean := FALSE;
  END;

  SELECT deletion_requested_at INTO v_marker_after FROM users WHERE id = v_user;

  PERFORM tap_ok(
    v_ran_clean AND v_marker_before = v_marker_after,
    're-running delete_my_account on an already-cascaded user is a harmless idempotent no-op (marker unchanged, no error)'
  );
END $$;

-- ==========================================================================
-- C. EXECUTE is denied to authenticated/anon on delete_my_account.
-- ==========================================================================
DO $$
DECLARE
  v_user   UUID;
  v_state  TEXT;
  v_denied BOOLEAN;
BEGIN
  v_user := test_seed_user();

  PERFORM test_become(v_user);
  v_denied := FALSE;
  BEGIN
    PERFORM delete_my_account(v_user);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE delete_my_account (service-role only)');

  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM delete_my_account(v_user);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_denied, 'anon cannot EXECUTE delete_my_account (service-role only)');
END $$;

-- ==========================================================================
-- D. deletion_requested_at is server-write-only (mirrors the subscription_tier
--    single-column check in t49; the dynamic allow-list completeness
--    assertion covering this column lives in t50).
-- ==========================================================================
DO $$
BEGIN
  PERFORM tap_ok(
    NOT has_column_privilege('authenticated', 'public.users', 'deletion_requested_at', 'UPDATE'),
    'authenticated is denied the effective UPDATE privilege on users.deletion_requested_at'
  );
  PERFORM tap_ok(
    NOT has_column_privilege('authenticated', 'public.users', 'deletion_requested_at', 'INSERT'),
    'authenticated is denied the effective INSERT privilege on users.deletion_requested_at'
  );
END $$;

-- ==========================================================================
-- E. FK-coverage guard -- every FK referencing public.users / auth.users is
--    CASCADE or SET NULL. A future unhandled RESTRICT/NO ACTION FK fails
--    this test loudly (forcing the author to extend the cascade) instead of
--    silently stranding a deletion behind an opaque FK violation.
-- ==========================================================================
DO $$
DECLARE
  v_bad_fks TEXT[];
BEGIN
  SELECT COALESCE(array_agg(bad.desc_line ORDER BY bad.desc_line), ARRAY[]::TEXT[])
  INTO v_bad_fks
  FROM (
    SELECT format(
      '%s.%s -> %s (ON DELETE %s)',
      con.conrelid::regclass::text,
      att.attname,
      con.confrelid::regclass::text,
      CASE con.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE con.confdeltype::text
      END
    ) AS desc_line
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND con.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
      AND con.confdeltype NOT IN ('c', 'n')
  ) AS bad;

  PERFORM tap_ok(
    cardinality(v_bad_fks) = 0,
    format(
      'every FK referencing public.users/auth.users is ON DELETE CASCADE or SET NULL (violations: %s)',
      COALESCE(array_to_string(v_bad_fks, ', '), '')
    )
  );
END $$;

-- ==========================================================================
-- F. search_path is pinned on both cascade functions.
-- ==========================================================================
DO $$
DECLARE
  v_delete_pinned BOOLEAN;
  v_sweep_pinned  BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'delete_my_account'
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS opt WHERE opt LIKE 'search_path=%')
  ) INTO v_delete_pinned;
  PERFORM tap_ok(COALESCE(v_delete_pinned, FALSE), 'delete_my_account pins a search_path');

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'complete_pending_account_deletions'
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS opt WHERE opt LIKE 'search_path=%')
  ) INTO v_sweep_pinned;
  PERFORM tap_ok(COALESCE(v_sweep_pinned, FALSE), 'complete_pending_account_deletions pins a search_path');
END $$;

-- ==========================================================================
-- G. complete_pending_account_deletions() -- the retry sweep.
-- ==========================================================================
DO $$
DECLARE
  v_state  TEXT;
  v_denied BOOLEAN;
BEGIN
  -- (G1) authenticated cannot EXECUTE the sweep.
  PERFORM test_become(test_seed_user());
  v_denied := FALSE;
  BEGIN
    PERFORM complete_pending_account_deletions();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE complete_pending_account_deletions (service-role only)');

  -- (G2) anon cannot EXECUTE the sweep.
  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM complete_pending_account_deletions();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_denied, 'anon cannot EXECUTE complete_pending_account_deletions (service-role only)');
END $$;

-- (G3) a user inside the 1-hour grace window is left untouched by the sweep
-- (it must never race the synchronous Edge path).
DO $$
DECLARE
  v_user          UUID;
  v_still_present BOOLEAN;
BEGIN
  v_user := test_seed_user();
  UPDATE users SET deletion_requested_at = NOW() - INTERVAL '10 minutes' WHERE id = v_user;

  PERFORM complete_pending_account_deletions();

  SELECT EXISTS(SELECT 1 FROM users WHERE id = v_user) INTO v_still_present;
  PERFORM tap_ok(
    v_still_present,
    'a user still inside the 1-hour grace window is left untouched by the sweep'
  );
END $$;

-- (G4) two OLD-marked users are BOTH fully removed in a single sweep
-- invocation -- batch correctness (per-row isolation must not stop the
-- sweep short of a healthy row).
DO $$
DECLARE
  v_user_a           UUID;
  v_user_b           UUID;
  v_a_users_gone     BOOLEAN;
  v_b_users_gone     BOOLEAN;
  v_a_auth_gone      BOOLEAN;
  v_b_auth_gone      BOOLEAN;
BEGIN
  v_user_a := test_seed_user();
  v_user_b := test_seed_user();
  UPDATE users SET deletion_requested_at = NOW() - INTERVAL '2 hours' WHERE id IN (v_user_a, v_user_b);

  PERFORM complete_pending_account_deletions();

  SELECT NOT EXISTS(SELECT 1 FROM users WHERE id = v_user_a) INTO v_a_users_gone;
  SELECT NOT EXISTS(SELECT 1 FROM users WHERE id = v_user_b) INTO v_b_users_gone;
  SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user_a) INTO v_a_auth_gone;
  SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user_b) INTO v_b_auth_gone;

  PERFORM tap_ok(
    v_a_users_gone AND v_b_users_gone AND v_a_auth_gone AND v_b_auth_gone,
    'two users past the grace window are BOTH fully removed (public.users + auth.users) in a single sweep run'
  );
END $$;

-- (G5) UN-CANCELLED-BILLING GATE: an OLD-marked user who STILL has a live Stripe
-- receipt (active/past_due) is NOT cascaded or auth-deleted by the sweep, and the
-- receipt is PRESERVED -- Phase A (provider cancel) never succeeded for them, so
-- cascading would destroy the receipt while Stripe keeps billing. The row is left
-- intact so a later Edge-Function retry can still cancel with the provider.
DO $$
DECLARE
  v_user            UUID;
  v_receipt         UUID := gen_random_uuid();
  v_users_present   BOOLEAN;
  v_auth_present    BOOLEAN;
  v_receipt_present BOOLEAN;
BEGIN
  v_user := test_seed_user();
  INSERT INTO subscription_receipts
    (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (v_receipt, v_user, 'stripe', 'sub_gate_live', 'active', NOW() + INTERVAL '10 days');
  UPDATE users SET deletion_requested_at = NOW() - INTERVAL '2 hours' WHERE id = v_user;

  PERFORM complete_pending_account_deletions();

  SELECT EXISTS(SELECT 1 FROM users WHERE id = v_user) INTO v_users_present;
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user) INTO v_auth_present;
  SELECT EXISTS(SELECT 1 FROM subscription_receipts WHERE id = v_receipt) INTO v_receipt_present;

  PERFORM tap_ok(
    v_users_present AND v_auth_present AND v_receipt_present,
    'the sweep does NOT finalize an old-marked user with a live Stripe receipt, and the receipt is preserved for a provider retry'
  );
END $$;

-- (G5b) The gate also covers 'pending'/incomplete Stripe receipts. Phase A now
-- cancels a pending sub (it can still activate + bill AFTER a hard delete), so
-- an OLD-marked user whose Phase A never cancelled a live pending receipt must
-- NOT be finalized by the sweep -- the row + receipt are preserved for a later
-- Edge retry, exactly like active/past_due (mirrors G5 with status = 'pending').
DO $$
DECLARE
  v_user            UUID;
  v_receipt         UUID := gen_random_uuid();
  v_users_present   BOOLEAN;
  v_auth_present    BOOLEAN;
  v_receipt_present BOOLEAN;
BEGIN
  v_user := test_seed_user();
  INSERT INTO subscription_receipts
    (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (v_receipt, v_user, 'stripe', 'sub_gate_pending', 'pending', NOW() + INTERVAL '10 days');
  UPDATE users SET deletion_requested_at = NOW() - INTERVAL '2 hours' WHERE id = v_user;

  PERFORM complete_pending_account_deletions();

  SELECT EXISTS(SELECT 1 FROM users WHERE id = v_user) INTO v_users_present;
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user) INTO v_auth_present;
  SELECT EXISTS(SELECT 1 FROM subscription_receipts WHERE id = v_receipt) INTO v_receipt_present;

  PERFORM tap_ok(
    v_users_present AND v_auth_present AND v_receipt_present,
    'the sweep does NOT finalize an old-marked user with a live PENDING Stripe receipt, and the receipt is preserved for a provider retry'
  );
END $$;

-- (G6) The gate is Stripe-only: an OLD-marked user whose only still-billing
-- receipt is apple/play (cancelled natively by the user -- no server cancel API,
-- so it must never gate finalization) IS fully finalized by the sweep.
DO $$
DECLARE
  v_user         UUID;
  v_receipt      UUID := gen_random_uuid();
  v_users_gone   BOOLEAN;
  v_auth_gone    BOOLEAN;
BEGIN
  v_user := test_seed_user();
  INSERT INTO subscription_receipts
    (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (v_receipt, v_user, 'apple_iap', 'apple_gate_native', 'active', NOW() + INTERVAL '10 days');
  UPDATE users SET deletion_requested_at = NOW() - INTERVAL '2 hours' WHERE id = v_user;

  PERFORM complete_pending_account_deletions();

  SELECT NOT EXISTS(SELECT 1 FROM users WHERE id = v_user) INTO v_users_gone;
  SELECT NOT EXISTS(SELECT 1 FROM auth.users WHERE id = v_user) INTO v_auth_gone;

  PERFORM tap_ok(
    v_users_gone AND v_auth_gone,
    'the sweep DOES finalize an old-marked user whose only receipt is apple/play (native cancel does not gate)'
  );
END $$;

-- ==========================================================================
-- H. auth.users DELETE privilege smoke-assertion -- the role that owns these
--    SECURITY DEFINER functions can directly DELETE FROM auth.users. The
--    sweep's finalizer relies on exactly this raw SQL privilege, since a
--    pg_cron-invoked function cannot call the GoTrue admin API.
-- ==========================================================================
DO $$
DECLARE
  v_user      UUID;
  v_rowcount  INT := 0;
  v_delete_ok BOOLEAN := FALSE;
BEGIN
  v_user := test_seed_user();
  BEGIN
    DELETE FROM auth.users WHERE id = v_user;
    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    v_delete_ok := v_rowcount = 1;
  EXCEPTION WHEN OTHERS THEN
    v_delete_ok := FALSE;
  END;
  PERFORM tap_ok(
    v_delete_ok,
    'the migration-owner role can directly DELETE FROM auth.users (the sweep''s finalizer relies on this raw privilege)'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
