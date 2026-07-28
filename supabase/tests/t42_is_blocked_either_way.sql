-- t42: the symmetric block predicate — truth table, NULL-safety, unblock
-- liveness, and its PostgREST exposure posture.
--
-- Coverage:
--   * exposure posture — the predicate must resolve to a schema PostgREST
--     does NOT expose as a callable RPC (i.e. NOT `public` / `graphql_public`),
--     with `authenticated` holding USAGE on that schema and EXECUTE on the
--     function (so the RLS policies that call it still work), and `anon`
--     holding neither. A blocked user must not be able to loop this
--     predicate over the userbase as a who-blocked-me oracle.
--   * the same four exposure-posture checks are mirrored for
--     private.collective_post_author — the post→real-author
--     de-anonymization primitive the write-gate policies call. A
--     client-callable version of it would let any signed-in user resolve a
--     pseudonymous post to its real users.id, independent of blocking.
--   * symmetric truth table — TRUE in both call orders once a block exists,
--     FALSE for an unrelated pair, FALSE for a self-pair.
--   * NULL-safety — a NULL argument (the tombstoned-author case) resolves
--     to FALSE, never NULL, so a NULL-propagation bug can't silently
--     over- or under-block.
--   * unblock liveness — deleting the block row flips the predicate back
--     to FALSE immediately (no cache, no stale state).
--
-- All catalog lookups below resolve the function's oid from pg_proc first
-- (a plain match on proname/pronamespace, which returns zero rows rather
-- than erroring when the function doesn't exist yet) and only then pass
-- that oid into has_function_privilege / has_schema_privilege — this keeps
-- the exposure-posture assertions failing cleanly in red phase instead of
-- raising "function does not exist". The direct predicate calls below that
-- DO reference the function by name are expected to raise in red phase and
-- take down the rest of this file's TAP output with them — an unambiguous
-- suite failure until the migration lands.
--
-- These assertions target the recommended resolution: both DEFINER helpers
-- live in a non-exposed `private` schema, called here as
-- `private.is_blocked_either_way(...)` (a bare call would not resolve --
-- the test session's search_path does not include `private`). If the
-- alternative (public schema + recorded product acceptance of the
-- enumeration hole) is chosen instead, this file's schema qualification
-- and the exposure-posture assertion both need updating to match.

BEGIN;
\i _helpers.psql
SELECT plan(14);

DO $$
DECLARE
  v_fn_oid       OID;
  v_fn_schema    TEXT;
  v_auth_exec    BOOLEAN;
  v_anon_exec    BOOLEAN;
  v_auth_usage   BOOLEAN;
BEGIN
  -- (1) the function resolves to a schema PostgREST does not expose.
  SELECT p.oid, n.nspname INTO v_fn_oid, v_fn_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'is_blocked_either_way'
  LIMIT 1;

  PERFORM tap_ok(
    v_fn_schema IS NOT NULL AND v_fn_schema NOT IN ('public', 'graphql_public'),
    format('is_blocked_either_way resolves to a non-exposed schema (found: %s)', COALESCE(v_fn_schema, '<missing>'))
  );

  -- (2) authenticated holds EXECUTE (required for the RLS policies that
  -- call this predicate to keep working).
  v_auth_exec := v_fn_oid IS NOT NULL AND has_function_privilege('authenticated', v_fn_oid, 'EXECUTE');
  PERFORM tap_ok(COALESCE(v_auth_exec, FALSE), 'authenticated has EXECUTE on is_blocked_either_way');

  -- (3) anon holds no EXECUTE at all.
  v_anon_exec := v_fn_oid IS NOT NULL AND has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  PERFORM tap_ok(v_fn_oid IS NOT NULL AND NOT COALESCE(v_anon_exec, TRUE), 'anon has no EXECUTE on is_blocked_either_way');

  -- (4) authenticated holds USAGE on the resolving schema (needed to reach
  -- the function at all once it is moved out of the public search path).
  v_auth_usage := v_fn_schema IS NOT NULL AND has_schema_privilege('authenticated', v_fn_schema, 'USAGE');
  PERFORM tap_ok(COALESCE(v_auth_usage, FALSE), 'authenticated has USAGE on the schema hosting is_blocked_either_way');
END $$;

-- Exposure posture for private.collective_post_author — mirrors (1)-(4)
-- above for the post→real-author de-anonymization primitive.
DO $$
DECLARE
  v_fn_oid       OID;
  v_fn_schema    TEXT;
  v_auth_exec    BOOLEAN;
  v_anon_exec    BOOLEAN;
  v_auth_usage   BOOLEAN;
BEGIN
  -- (5) the function resolves to a schema PostgREST does not expose.
  SELECT p.oid, n.nspname INTO v_fn_oid, v_fn_schema
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'collective_post_author'
  LIMIT 1;

  PERFORM tap_ok(
    v_fn_schema IS NOT NULL AND v_fn_schema NOT IN ('public', 'graphql_public'),
    format('collective_post_author resolves to a non-exposed schema (found: %s)', COALESCE(v_fn_schema, '<missing>'))
  );

  -- (6) authenticated holds EXECUTE (required for the RLS policies that
  -- call this helper to keep working).
  v_auth_exec := v_fn_oid IS NOT NULL AND has_function_privilege('authenticated', v_fn_oid, 'EXECUTE');
  PERFORM tap_ok(COALESCE(v_auth_exec, FALSE), 'authenticated has EXECUTE on collective_post_author');

  -- (7) anon holds no EXECUTE at all.
  v_anon_exec := v_fn_oid IS NOT NULL AND has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  PERFORM tap_ok(v_fn_oid IS NOT NULL AND NOT COALESCE(v_anon_exec, TRUE), 'anon has no EXECUTE on collective_post_author');

  -- (8) authenticated holds USAGE on the resolving schema.
  v_auth_usage := v_fn_schema IS NOT NULL AND has_schema_privilege('authenticated', v_fn_schema, 'USAGE');
  PERFORM tap_ok(COALESCE(v_auth_usage, FALSE), 'authenticated has USAGE on the schema hosting collective_post_author');
END $$;

DO $$
DECLARE
  v_alice UUID;
  v_bob   UUID;
  v_carol UUID;
BEGIN
  v_alice := test_seed_user();
  v_bob   := test_seed_user();
  v_carol := test_seed_user();

  -- Seed directly as table owner (bypasses user_blocks' one-sided RLS) so
  -- this file's fixture setup doesn't depend on t41's own RLS coverage.
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);

  -- (9)/(10) symmetric truth: TRUE in both call orders.
  PERFORM tap_ok(
    private.is_blocked_either_way(v_alice, v_bob) IS TRUE,
    'is_blocked_either_way(blocker, blocked) is TRUE once a block exists'
  );
  PERFORM tap_ok(
    private.is_blocked_either_way(v_bob, v_alice) IS TRUE,
    'is_blocked_either_way(blocked, blocker) is TRUE — symmetric'
  );

  -- (11) an unrelated pair is FALSE.
  PERFORM tap_ok(
    private.is_blocked_either_way(v_alice, v_carol) IS FALSE,
    'is_blocked_either_way is FALSE for an unrelated pair'
  );

  -- (12) the self-pair is FALSE (own posts must never be hidden).
  PERFORM tap_ok(
    private.is_blocked_either_way(v_alice, v_alice) IS FALSE,
    'is_blocked_either_way(uid, uid) is FALSE — a user is never blocked from themselves'
  );

  -- (13) NULL-safety: a NULL argument (tombstoned author) resolves to
  -- FALSE, never NULL — `IS FALSE` fails on both TRUE and NULL results.
  PERFORM tap_ok(
    private.is_blocked_either_way(v_alice, NULL) IS FALSE,
    'is_blocked_either_way(uid, NULL) is FALSE, not NULL (tombstoned-author safety)'
  );

  -- (14) unblock liveness: deleting the row flips the predicate back
  -- immediately — no cache, no stale state.
  DELETE FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  PERFORM tap_ok(
    private.is_blocked_either_way(v_alice, v_bob) IS FALSE,
    'is_blocked_either_way flips back to FALSE immediately after the block row is deleted'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
