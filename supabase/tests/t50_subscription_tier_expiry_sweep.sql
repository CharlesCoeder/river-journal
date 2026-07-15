-- t50: the period-end tier-flip sweep (expire_lapsed_subscription_tiers) and
-- the folded-in hardening trio on public.users / subscription_receipts.
--
-- Coverage:
--   * the sweep's entitlement predicate is
--     `current_period_end > now() AND status IN ('active','canceled','past_due')`,
--     NOT a bare `status = 'active'`:
--       - a user whose only receipt is canceled with a PAST period_end is
--         downgraded to 'free';
--       - a user whose Stripe receipt is status='canceled' but
--         current_period_end is still in the FUTURE (the cancel-at-period-end
--         grace window) is NOT downgraded;
--       - a user with a still-active, in-period receipt is NOT downgraded;
--       - a user with a 'past_due' receipt and a future period_end is NOT
--         downgraded (the dunning grace window also entitles);
--       - a user whose only receipt is 'pending' (even with a future
--         period_end) IS downgraded -- 'pending' never entitles;
--       - a user whose only receipt is 'expired' (even with a future
--         period_end) IS downgraded -- 'expired' never entitles;
--   * cross-platform entitlement: a user with an expired/lapsed Stripe
--     receipt AND a still-active Apple receipt is NOT downgraded -- the
--     entitling-row check is keyed on user_id across ALL providers;
--   * multi-user isolation: a single sweep invocation downgrades exactly the
--     lapsed user and leaves the entitled user (seeded in the same pass)
--     untouched;
--   * a user already at 'free' with no receipts at all is left alone (no
--     error, no spurious write);
--   * comp/admin-grant caveat pinned: a PAID-tier user with ZERO receipt rows
--     IS downgraded to 'free' -- receipt-backed entitlement is the sole source
--     of paid tier, so a receipt-less grant is stomped by the sweep;
--   * hardening trio (carried forward from an earlier privilege-hardening pass):
--       - the `authenticated` UPDATE column allow-list on public.users is
--         EXACTLY every column except subscription_tier and
--         deletion_requested_at (the account-deletion partial-state marker,
--         also server-write-only -- allow-list completeness guards a future
--         ADD COLUMN silently reopening client write access to every new
--         column, including this one);
--       - the `authenticated` INSERT column allow-list mirrors the same
--         shape (closes the INSERT path the same way the UPDATE path was
--         already closed -- a bare column-scoped REVOKE INSERT is a
--         documented no-op while the table-level INSERT grant stands, so
--         this asserts the EFFECTIVE privilege via has_column_privilege,
--         not merely that a REVOKE statement executed without error);
--       - a whitespace-only provider_subscription_id is rejected by the
--         tightened (btrim(...) <> '') CHECK;
--   * the sweep function itself is not directly callable: EXECUTE is denied
--     to `authenticated` and to `anon`, and its search_path is pinned.
--
-- pg_cron scheduling note: this migration schedules the sweep inside a
-- pg_extension-existence-gated DO block (pg_cron is unavailable in local
-- Docker), exactly mirroring the streak-reminder cron migration. That prior
-- migration's regression suite never asserts against a `cron.job` row for
-- the same reason -- there is nothing to assert locally, and the scheduling
-- statement leaves no artifact in the database when the extension is absent.
-- This file follows the identical precedent and asserts only the SQL-callable
-- surface (the sweep function + the privilege hardening), not cron
-- registration.
--
-- Red phase: expire_lapsed_subscription_tiers() does not exist yet, so the
-- first call below raises "function ... does not exist" and the whole file
-- aborts with no TAP output -- an unambiguous suite failure until the
-- migration lands. The btrim-CHECK assertion (14) would additionally FAIL
-- outright (not abort) against the pre-migration schema, since the current
-- CHECK only rejects an exact empty string, not a whitespace-only one.
--
-- Amendment (account-deletion follow-up): assertions (11)/(12) now also
-- exclude deletion_requested_at from the expected allow-list. This is a
-- forward-compatible, currently-a-no-op change against the pre-migration
-- schema -- deletion_requested_at does not exist yet, so excluding a column
-- that is not there does not change either side of the comparison, and this
-- file stays GREEN today. The assertion becomes load-bearing the moment the
-- account-deletion migration adds the column: it will correctly FAIL if that
-- migration forgets to exclude deletion_requested_at from the authenticated
-- UPDATE/INSERT grants, exactly the same allow-list-completeness guarantee
-- subscription_tier already has. This file was updated ahead of that
-- migration landing, per the account-deletion story's explicit contract.

BEGIN;
\i _helpers.psql
SELECT plan(19);

DO $$
DECLARE
  v_user               UUID;
  v_user_b             UUID;
  v_tier               public.subscription_tier;
  v_tier_b             public.subscription_tier;
  v_actual_update_cols TEXT[];
  v_expected_cols      TEXT[];
  v_actual_insert_cols TEXT[];
  v_btrim_rejected     BOOLEAN := FALSE;
  v_denied             BOOLEAN;
  v_state              TEXT;
  v_search_path_pinned BOOLEAN;
BEGIN
  -- ── (1) fully lapsed: canceled + PAST period_end -> downgraded ──────────
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_lapsed', 'canceled', NOW() - INTERVAL '1 day');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'free',
    'a user whose only receipt is canceled with a past current_period_end is downgraded to free'
  );

  -- ── (2) grace window: canceled + FUTURE period_end -> NOT downgraded ────
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_grace', 'canceled', NOW() + INTERVAL '5 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'paid_monthly',
    'a canceled Stripe receipt with a FUTURE current_period_end (the cancel-at-period-end grace window) is NOT downgraded'
  );

  -- ── (3) still-active, in-period -> NOT downgraded ────────────────────────
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_yearly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_active', 'active', NOW() + INTERVAL '20 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'paid_yearly',
    'a user with a still-active, in-period receipt is NOT downgraded'
  );

  -- ── (4) past_due + future period_end -> NOT downgraded (dunning grace) ──
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_pastdue', 'past_due', NOW() + INTERVAL '3 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'paid_monthly',
    'a past_due receipt with a future current_period_end is NOT downgraded (dunning grace window entitles)'
  );

  -- ── (5) pending-only, even with a future period_end -> downgraded ───────
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_pending', 'pending', NOW() + INTERVAL '10 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'free',
    'a user whose only receipt is pending (even with a future current_period_end) is downgraded -- pending never entitles'
  );

  -- ── (6) expired-only, even with a future period_end -> downgraded ───────
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_expired', 'expired', NOW() + INTERVAL '10 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'free',
    'a user whose only receipt is expired (even with a future current_period_end) is downgraded -- expired never entitles'
  );

  -- ── (7) cross-provider: expired Stripe + active Apple -> NOT downgraded ─
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id = v_user;
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_crossprovider_lapsed', 'canceled', NOW() - INTERVAL '2 days');
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'apple_iap', 'apple_sweep_crossprovider_active', 'active', NOW() + INTERVAL '15 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'paid_monthly',
    'a user with a lapsed Stripe receipt but a still-active Apple receipt is NOT downgraded (cross-platform entitlement)'
  );

  -- ── (8)/(9) multi-user isolation: one lapsed + one entitled in one pass ─
  v_user   := test_seed_user();   -- lapsed
  v_user_b := test_seed_user();   -- entitled
  UPDATE users SET subscription_tier = 'paid_monthly' WHERE id IN (v_user, v_user_b);
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user, 'stripe', 'sub_sweep_isolation_lapsed', 'canceled', NOW() - INTERVAL '1 day');
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (gen_random_uuid(), v_user_b, 'stripe', 'sub_sweep_isolation_active', 'active', NOW() + INTERVAL '30 days');
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier   FROM users WHERE id = v_user;
  SELECT subscription_tier INTO v_tier_b FROM users WHERE id = v_user_b;
  PERFORM tap_ok(v_tier = 'free', 'multi-user isolation: the lapsed user in a shared sweep pass is downgraded');
  PERFORM tap_ok(v_tier_b = 'paid_monthly', 'multi-user isolation: the entitled user in the SAME sweep pass is left untouched');

  -- ── (10) already-free, no receipts at all -> left alone, no error ───────
  v_user := test_seed_user();
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'free',
    'a user already at free with no receipts at all is left alone and the sweep raises no error'
  );

  -- ── (10b) PAID tier + ZERO receipt rows -> downgraded (comp/admin caveat) ─
  -- Pins the documented comp/admin-grant caveat: receipt-backed entitlement is
  -- the SOLE source of paid tier, so a paid-tier user with NO receipt rows at all
  -- IS swept to 'free'. This distinguishes the caveat from test (10)'s
  -- already-free/no-receipt case -- here the user starts PAID. A future
  -- receipt-less comp grant must carry a synthetic entitling receipt or be
  -- excluded, or the sweep will stomp it.
  v_user := test_seed_user();
  UPDATE users SET subscription_tier = 'paid_yearly' WHERE id = v_user;
  PERFORM expire_lapsed_subscription_tiers();
  SELECT subscription_tier INTO v_tier FROM users WHERE id = v_user;
  PERFORM tap_ok(
    v_tier = 'free',
    'a paid-tier user with zero receipt rows is downgraded to free (comp/admin-grant caveat enforced, not merely documented)'
  );

  -- ── (11) UPDATE column allow-list completeness ───────────────────────────
  -- The effective set of users columns `authenticated` may UPDATE must be
  -- EXACTLY every column except subscription_tier AND deletion_requested_at
  -- -- computed dynamically (not hardcoded) so a future ADD COLUMN that
  -- forgets to extend the allow-list fails this assertion rather than
  -- silently reopening access. deletion_requested_at joined this exclusion
  -- set alongside subscription_tier: it is the account-deletion partial-state
  -- marker and must stay server-write-only (a client could otherwise dodge
  -- the retry sweep by writing it to a future value, or erase it to hide an
  -- in-progress deletion).
  -- MATERIALIZED fence: has_column_privilege() raises a hard ERROR on a column
  -- name absent from public.users, and the planner is free to evaluate it before
  -- the table_schema/table_name filter — hitting auth.users columns
  -- (instance_id, ...) that share the unqualified name 'users'. Materializing the
  -- filtered public.users column set first guarantees the privilege check only
  -- ever sees real public.users columns.
  WITH public_users_cols AS MATERIALIZED (
    SELECT c.column_name AS col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'users'
  )
  SELECT COALESCE(array_agg(col ORDER BY col), ARRAY[]::TEXT[])
  INTO v_actual_update_cols
  FROM public_users_cols
  WHERE has_column_privilege('authenticated', 'public.users', col, 'UPDATE');

  SELECT COALESCE(array_agg(c.column_name ORDER BY c.column_name), ARRAY[]::TEXT[])
  INTO v_expected_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'users'
    AND c.column_name NOT IN ('subscription_tier', 'deletion_requested_at');

  PERFORM tap_ok(
    v_actual_update_cols = v_expected_cols,
    format(
      'authenticated UPDATE column allow-list on users is exactly every column except subscription_tier and deletion_requested_at (actual: %s)',
      array_to_string(v_actual_update_cols, ', ')
    )
  );

  -- ── (12) INSERT column allow-list mirrors the UPDATE allow-list ─────────
  WITH public_users_cols AS MATERIALIZED (
    SELECT c.column_name AS col
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'users'
  )
  SELECT COALESCE(array_agg(col ORDER BY col), ARRAY[]::TEXT[])
  INTO v_actual_insert_cols
  FROM public_users_cols
  WHERE has_column_privilege('authenticated', 'public.users', col, 'INSERT');

  PERFORM tap_ok(
    v_actual_insert_cols = v_expected_cols,
    format(
      'authenticated INSERT column allow-list on users mirrors the UPDATE allow-list (every column except subscription_tier and deletion_requested_at) (actual: %s)',
      array_to_string(v_actual_insert_cols, ', ')
    )
  );

  -- ── (13)/(14) direct column-privilege denial on subscription_tier ───────
  -- Belt-and-suspenders single-column checks, distinct from the completeness
  -- sweep above -- the load-bearing point is that a no-op column-scoped
  -- REVOKE would still pass a weaker "the REVOKE statement ran" test, so
  -- this asserts the EFFECTIVE privilege directly.
  PERFORM tap_ok(
    NOT has_column_privilege('authenticated', 'public.users', 'subscription_tier', 'UPDATE'),
    'authenticated is denied the effective UPDATE privilege on users.subscription_tier'
  );
  PERFORM tap_ok(
    NOT has_column_privilege('authenticated', 'public.users', 'subscription_tier', 'INSERT'),
    'authenticated is denied the effective INSERT privilege on users.subscription_tier'
  );

  -- ── (15) btrim CHECK: whitespace-only provider_subscription_id rejected ─
  v_user := test_seed_user();
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_user, 'stripe', '   ', 'active', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN check_violation THEN v_btrim_rejected := TRUE;
  END;
  PERFORM tap_ok(
    v_btrim_rejected,
    'a whitespace-only provider_subscription_id is rejected by the tightened btrim(...) <> '''' CHECK'
  );

  -- ── (16) authenticated cannot EXECUTE the sweep function ────────────────
  v_user := test_seed_user();
  PERFORM test_become(v_user);
  v_denied := FALSE;
  BEGIN
    PERFORM expire_lapsed_subscription_tiers();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE expire_lapsed_subscription_tiers (service-role only)');

  -- ── (17) anon cannot EXECUTE the sweep function ──────────────────────────
  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM expire_lapsed_subscription_tiers();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'anon cannot EXECUTE expire_lapsed_subscription_tiers (service-role only)');

  -- ── (18) search_path is pinned on the sweep function ─────────────────────
  -- Redundant with the repo-wide SECURITY DEFINER sweep (which will also
  -- catch this function once it exists), asserted directly here too since
  -- it is explicitly part of this migration's hardening surface.
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'expire_lapsed_subscription_tiers'
      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS opt WHERE opt LIKE 'search_path=%')
  ) INTO v_search_path_pinned;
  PERFORM tap_ok(
    COALESCE(v_search_path_pinned, FALSE),
    'expire_lapsed_subscription_tiers pins a search_path'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
