-- t47: unread_replies_for_user(since) -- the auth.uid()-scoped SECURITY
-- DEFINER count RPC backing the web/desktop in-app reminder card's
-- unread-reply signal.
--
-- Seeding convention (mirrors t46 block A): collective_posts/collective_reply
-- fixture rows are inserted WITHOUT switching into `authenticated` first --
-- the ambient role at that point is the superuser/table-owner role pgTAP runs
-- under, which bypasses collective_posts' RLS entirely (including the
-- 500-words-completion posting gate this file has no need to satisfy). Only
-- two things genuinely require switching role: (1) `user_blocks` INSERTs,
-- whose `user_blocks_insert_own` RLS policy is scoped to the blocker
-- (test_become(blocker) first), and (2) the `unread_replies_for_user(...)`
-- call itself, which must run AS a real `authenticated` caller (test_become)
-- so `auth.uid()` resolves and the SECURITY DEFINER owner-chain assertions in
-- block C are genuine end-to-end proofs, not superuser-bypassed no-ops.
--
-- Coverage map:
--   A. Defensive NULL handling -- a caller holding the `authenticated` grant
--      but with no `sub` claim (auth.uid() IS NULL) gets 0, never an error.
--   B. A caller with no authored posts anywhere returns 0.
--   C. The count matrix + END-TO-END PRIVILEGE CHAIN: a reply whose
--      IMMEDIATE PARENT is authored by the caller, AND a reply nested two
--      levels deep whose immediate parent is NOT the caller but whose
--      THREAD ROOT is -- both counted, called end-to-end under a REAL
--      `authenticated` JWT (test_become), not a superuser test caller. The
--      second reply's inclusion is only reachable via the recursive
--      thread_root_user_id(...) nested call, which is genuinely
--      service-role-only at the SQL grant level (REVOKE ... FROM PUBLIC,
--      authenticated) -- so this assertion is the proof the SECURITY
--      DEFINER owner-chain bypass actually resolves for a real authenticated
--      caller. A broken owner chain would raise 42501 here while still
--      passing under a postgres/service-role test caller, which is exactly
--      the blind spot a GRANT-only assertion would miss.
--   D. since-boundary semantics: a reply created strictly before `since` is
--      excluded; a reply created AT EXACTLY `since` is also excluded (the
--      predicate is `created_at > since`, not `>=`).
--   E. Own-reply exclusion: a caller who replies to their OWN post is not
--      counted as their own recipient.
--   F. Block filter, both directions (seeded separately, mirrors t46).
--   G. Soft-removed (is_removed) reply exclusion.
--   H. Anonymized-author (user_id SET NULL) reply exclusion.
--   I. Unrelated-thread negative control: a reply in a thread the caller has
--      no ancestry in at all is never counted (guards against an
--      accidentally too-broad OR).
--   J. auth.uid() scoping: an uninvolved second caller never sees the first
--      caller's count.
--   K. Access control: anon is denied (42501); the PUBLIC pseudo-role has no
--      EXECUTE privilege; authenticated does.
--   L. Unbounded `since` (epoch): a caller-supplied `since` far in the past
--      still returns only that caller's own scoped count, not a leak or an
--      error -- the amplification surface is accepted (own-count only), not
--      a cross-user enumeration oracle.
--
-- Red phase: unread_replies_for_user does not exist yet, so the first call
-- in block A raises "function unread_replies_for_user(timestamp with time
-- zone) does not exist", aborting the whole file before a single tap_ok line
-- is emitted -- an unambiguous whole-suite failure (mirrors t39/t45/t46's
-- red-phase abort shape) until the migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(16);

-- ==========================================================================
-- A. Defensive NULL handling -- authenticated grant, no `sub` claim.
-- ==========================================================================
DO $$
DECLARE
  v_result INT;
BEGIN
  -- Mirrors test_become_anon()'s shape but keeps role = authenticated, so
  -- the GRANT itself is not what this probes (that is block K below) -- only
  -- the function's own defensive `auth.uid() IS NULL -> 0` branch.
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);

  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(
    v_result = 0,
    'unread_replies_for_user returns 0 (never an error) when auth.uid() is NULL despite holding the authenticated grant'
  );
END $$;

-- ==========================================================================
-- B. A caller with no authored posts anywhere returns 0.
-- ==========================================================================
DO $$
DECLARE
  v_lonely UUID;
  v_result INT;
BEGIN
  v_lonely := test_seed_user();
  PERFORM test_become(v_lonely);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(v_result = 0, 'a caller with no authored posts anywhere returns 0');
END $$;

-- ==========================================================================
-- C. Count matrix + end-to-end privilege chain (parent-author path AND
--    root-author path via thread_root_user_id), plus the unbounded-since
--    (epoch) scoped-count check reusing the SAME fixture.
-- ==========================================================================
DO $$
DECLARE
  v_me            UUID;
  v_other_a       UUID;
  v_other_b       UUID;
  v_top           UUID := gen_random_uuid();
  v_direct_reply  UUID := gen_random_uuid();
  v_mid           UUID := gen_random_uuid();
  v_leaf          UUID := gen_random_uuid();
  v_direct_created TIMESTAMPTZ;
  v_leaf_created   TIMESTAMPTZ;
  v_since         TIMESTAMPTZ;
  v_result        INT;
  v_epoch_result  INT;
BEGIN
  v_me      := test_seed_user();
  v_other_a := test_seed_user();
  v_other_b := test_seed_user();

  -- Seed fixture rows as the ambient (RLS-bypassing) role -- no test_become
  -- before these INSERTs. See the header note: only the block-insert and the
  -- RPC-call sites below need a real `authenticated` switch.
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for the unread-count matrix', 'root-body');

  -- (1) Direct reply to v_me's top-level post -- the immediate-parent-author
  -- path (v_me is the post's own author, so the cheap non-recursive check
  -- alone would already match this one).
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_direct_reply, v_other_a, 'direct-reply-to-me', v_top);

  -- (2) Multi-level chain: v_mid (reply to v_top, authored by v_other_a) --
  -- itself ALSO a direct reply to v_me's post, so it independently qualifies
  -- via the SAME parent-author path as (1) -- then v_leaf (reply to v_mid,
  -- authored by v_other_b). v_leaf's IMMEDIATE parent author is v_other_a
  -- (NOT v_me) -- only the recursive thread_root_user_id walk (resolving to
  -- v_me, the root author) makes v_leaf count. This is exactly the
  -- service-role-only nested call the owner chain must reach for a real
  -- `authenticated` caller. Three replies total qualify: v_direct_reply and
  -- v_mid via the parent-author path, v_leaf via the root-author-only path.
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_mid, v_other_a, 'mid-reply', v_top);

  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_leaf, v_other_b, 'leaf-reply-via-root-author-path', v_mid);

  SELECT created_at INTO v_direct_created FROM collective_posts WHERE id = v_direct_reply;
  SELECT created_at INTO v_leaf_created FROM collective_posts WHERE id = v_leaf;
  v_since := LEAST(v_direct_created, v_leaf_created) - INTERVAL '1 second';

  -- Called AS v_me under a REAL authenticated JWT (test_become), never
  -- postgres/superuser -- the end-to-end proof required alongside the GRANT
  -- checks in block K: a broken SECURITY DEFINER owner chain would surface
  -- as 42501 here for this genuinely-`authenticated` caller even though a
  -- postgres/service-role test caller would never observe the break.
  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(v_since) INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(
    v_result = 3,
    'unread_replies_for_user counts both immediate-parent-authored replies AND the root-authored-only (multi-level, via thread_root_user_id) reply -- 3 total -- called end-to-end under a real authenticated JWT'
  );

  -- Unbounded (epoch) since: still a caller-scoped count, not a leak or an
  -- error, even though it forces the recursive root-author walk over the
  -- entire reply history for this caller.
  PERFORM test_become(v_me);
  SELECT unread_replies_for_user('1970-01-01T00:00:00Z'::timestamptz) INTO v_epoch_result;
  RESET ROLE;

  PERFORM tap_ok(
    v_epoch_result = 3,
    'an epoch `since` still returns only the caller''s own scoped count (3), not an inflated or errored result'
  );
END $$;

-- ==========================================================================
-- D. since-boundary semantics: strictly-before is excluded; exactly-at-since
--    is also excluded (created_at > since, never >=).
-- ==========================================================================
DO $$
DECLARE
  v_me      UUID;
  v_other   UUID;
  v_top     UUID := gen_random_uuid();
  v_reply   UUID := gen_random_uuid();
  v_created TIMESTAMPTZ;
  v_result  INT;
BEGIN
  v_me    := test_seed_user();
  v_other := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for the since-boundary probe', 'root-body');

  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_other, 'boundary-reply', v_top);

  SELECT created_at INTO v_created FROM collective_posts WHERE id = v_reply;

  -- `since` set to strictly AFTER the reply's own created_at -- the reply
  -- was created BEFORE since, so it is excluded.
  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(v_created + INTERVAL '1 second') INTO v_result;
  RESET ROLE;
  PERFORM tap_ok(v_result = 0, 'a reply created strictly before `since` is excluded');

  -- `since` set to EXACTLY the reply's own created_at -- created_at > since
  -- is false when they are equal, so it is still excluded.
  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(v_created) INTO v_result;
  RESET ROLE;
  PERFORM tap_ok(
    v_result = 0,
    'a reply created at EXACTLY `since` is excluded (created_at > since is strict, not >=)'
  );
END $$;

-- ==========================================================================
-- E. Own-reply exclusion: the caller replying to their own post is not
--    counted as their own recipient.
-- ==========================================================================
DO $$
DECLARE
  v_me     UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_result INT;
BEGIN
  v_me := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for the own-reply probe', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_me, 'self-reply', v_top);

  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(v_result = 0, 'a caller''s OWN reply to their own post is never counted as their own recipient');
END $$;

-- ==========================================================================
-- F. Block filter -- both directions.
-- ==========================================================================
DO $$
DECLARE
  v_me     UUID;
  v_other  UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_result INT;
BEGIN
  -- (F1) The reply's author blocks the caller.
  v_me    := test_seed_user();
  v_other := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for block-direction-1', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_other, 'reply-from-blocker', v_top);

  PERFORM test_become(v_other);
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_other, v_me);
  RESET ROLE;

  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;
  PERFORM tap_ok(v_result = 0, 'a reply whose author blocks the caller is excluded');
END $$;

DO $$
DECLARE
  v_me     UUID;
  v_other  UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_result INT;
BEGIN
  -- (F2) The caller blocks the reply's author (opposite direction).
  v_me    := test_seed_user();
  v_other := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for block-direction-2', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_other, 'reply-from-blocked-user', v_top);

  PERFORM test_become(v_me);
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_me, v_other);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;
  PERFORM tap_ok(
    v_result = 0,
    'a reply whose author is blocked BY the caller (opposite direction) is also excluded -- the filter is symmetric'
  );
END $$;

-- ==========================================================================
-- G. Soft-removed (is_removed) reply exclusion.
-- ==========================================================================
DO $$
DECLARE
  v_me     UUID;
  v_other  UUID;
  v_admin  UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_result INT;
BEGIN
  v_me    := test_seed_user();
  v_other := test_seed_user();
  v_admin := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for the removed-reply probe', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_other, 'reply-to-be-removed', v_top);

  PERFORM test_become_admin(v_admin);
  PERFORM remove_post(v_reply, 'spam', NULL);
  RESET ROLE;

  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(v_result = 0, 'a soft-removed (is_removed) reply is excluded from the count');
END $$;

-- ==========================================================================
-- H. Anonymized-author (user_id SET NULL) reply exclusion.
-- ==========================================================================
DO $$
DECLARE
  v_me     UUID;
  v_other  UUID;
  v_top    UUID := gen_random_uuid();
  v_reply  UUID := gen_random_uuid();
  v_result INT;
BEGIN
  v_me    := test_seed_user();
  v_other := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_top, v_me, 'Root for the anonymized-author probe', 'root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply, v_other, 'reply-to-be-anonymized', v_top);

  -- Simulate account deletion's soft-anonymization directly (mirrors t46's
  -- anon-root fixture), rather than performing a full account delete.
  UPDATE collective_posts SET user_id = NULL WHERE id = v_reply;

  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(v_result = 0, 'a reply whose author has been anonymized (user_id SET NULL) is excluded');
END $$;

-- ==========================================================================
-- I. Unrelated-thread negative control -- a reply the caller has no
--    ancestry relationship to at all is never counted.
-- ==========================================================================
DO $$
DECLARE
  v_me           UUID;
  v_stranger     UUID;
  v_replier      UUID;
  v_stranger_top UUID := gen_random_uuid();
  v_unrelated_reply UUID := gen_random_uuid();
  v_result       INT;
BEGIN
  v_me       := test_seed_user();
  v_stranger := test_seed_user();
  v_replier  := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_stranger_top, v_stranger, 'A thread v_me has no ancestry in', 'stranger-root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_unrelated_reply, v_replier, 'unrelated-reply', v_stranger_top);

  PERFORM test_become(v_me);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result;
  RESET ROLE;

  PERFORM tap_ok(
    v_result = 0,
    'a reply in a thread the caller has no parent/root ancestry in at all is never counted'
  );
END $$;

-- ==========================================================================
-- J. auth.uid() scoping -- an uninvolved second caller never sees another
--    caller's count.
-- ==========================================================================
DO $$
DECLARE
  v_a         UUID;
  v_b         UUID;
  v_replier   UUID;
  v_a_top     UUID := gen_random_uuid();
  v_b_top     UUID := gen_random_uuid();
  v_reply_on_a UUID := gen_random_uuid();
  v_result_a  INT;
  v_result_b  INT;
BEGIN
  v_a       := test_seed_user();
  v_b       := test_seed_user();
  v_replier := test_seed_user();

  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_a_top, v_a, 'a''s root for the scoping probe', 'a-root-body');
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_b_top, v_b, 'b''s root -- no replies ever land here', 'b-root-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_reply_on_a, v_replier, 'reply-on-a-only', v_a_top);

  PERFORM test_become(v_a);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result_a;
  RESET ROLE;

  PERFORM test_become(v_b);
  SELECT unread_replies_for_user(NOW() - INTERVAL '1 day') INTO v_result_b;
  RESET ROLE;

  PERFORM tap_ok(
    v_result_a = 1 AND v_result_b = 0,
    'auth.uid() scoping holds: a sees their own qualifying reply (1), b (uninvolved) sees 0 -- never a''s count'
  );
END $$;

-- ==========================================================================
-- K. Access control -- REVOKE/GRANT posture.
-- ==========================================================================
DO $$
DECLARE
  v_state  TEXT;
  v_denied BOOLEAN;
BEGIN
  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM unread_replies_for_user(NOW() - INTERVAL '1 day');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_denied, 'anon cannot EXECUTE unread_replies_for_user (SQLSTATE 42501)');
END $$;

DO $$
BEGIN
  PERFORM tap_ok(
    NOT has_function_privilege('public', 'public.unread_replies_for_user(timestamptz)', 'EXECUTE'),
    'the PUBLIC pseudo-role has no EXECUTE privilege on unread_replies_for_user'
  );
END $$;

DO $$
BEGIN
  PERFORM tap_ok(
    has_function_privilege('authenticated', 'public.unread_replies_for_user(timestamptz)', 'EXECUTE'),
    'the authenticated role has EXECUTE privilege on unread_replies_for_user'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
