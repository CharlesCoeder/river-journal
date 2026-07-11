-- t43: full two-user integration matrix for the block boundary folded into
-- every Collective read/write path.
--
-- Fixture: alice and bob each author a top-level post and a pre-existing
-- reply under the other's post, and carol reacts on bob's post — all BEFORE
-- alice blocks bob. The block is then established and every read/write
-- surface is checked for symmetric, silent enforcement:
--   * feed / thread_root / thread_page reads exclude the blocked pair's
--     content in BOTH directions, in both the full-mode and preview-mode
--     branches, while the caller's own posts are never hidden;
--   * reply-to-blocked and react-to-blocked INSERTs are denied in BOTH
--     directions (this is also the proof that the reply/reaction gates
--     resolve the post author through the DEFINER helper rather than a raw
--     sub-select against collective_posts — a raw sub-select would read as
--     NULL under the caller's own RLS and silently let these INSERTs
--     through, so a passing result here is what closes that hole);
--   * a pre-existing reaction on a blocked author's post is hidden from the
--     direct client-facing SELECT, with a same-shaped query as the post's
--     own (unblocked) author proving the row itself still exists;
--   * collective_reports INSERTs are permitted in both directions — block
--     is independent of reporting;
--   * a duplicate block raises unique_violation, an unblock (DELETE) makes
--     the pair's content reappear immediately, and deleting a user's
--     account hard-deletes any block row naming them on either side;
--   * a tombstoned author (user_id already SET NULL by account deletion)
--     stays visible and a reply to their post is not spuriously denied;
--   * descendant_count is pinned to the filtered-walk behavior (a blocked
--     author's reply is excluded from the count, not merely from the
--     visible row list) — if a future change accepts the count-oracle
--     instead of filtering the walk, this single assertion is expected to
--     flip and needs updating alongside that decision;
--   * depth-2 recursion: a blocked author's reply nested UNDER a non-blocked
--     author's reply is excluded from both descendant_count and the visible
--     row list — this exercises the recursive term of the descendant walk
--     (deeper JOIN collective_posts ... deeper), not merely the base-case
--     direct-child term the depth-1 fixture above already covers;
--   * thread_page's preview-mode branch (not just feed's) filters a blocked
--     author's reply for a sub-500 viewer;
--   * admin moderation RPCs are NOT filtered — moderation must see
--     everything regardless of any block between the parties involved;
--   * a user's own-posts read is unaffected by being blocked by someone
--     else.
--
-- Red phase: user_blocks / is_blocked_either_way do not exist yet, so the
-- block-establishing INSERT partway through this file raises "relation
-- user_blocks does not exist" and the whole file aborts with no TAP
-- output — an unambiguous suite failure until the three migrations land.

BEGIN;
\i _helpers.psql
SELECT plan(30);

DO $$
DECLARE
  v_alice             UUID;
  v_bob               UUID;
  v_carol             UUID;
  v_a_top             UUID := gen_random_uuid();
  v_b_top             UUID := gen_random_uuid();
  v_bob_reply_on_a    UUID := gen_random_uuid();
  v_alice_reply_on_b  UUID := gen_random_uuid();
  v_carol_reply_on_a  UUID := gen_random_uuid();
  v_bob_reply_on_carol UUID := gen_random_uuid();
  v_admin             UUID;
  v_erin              UUID;
  v_t_erin            UUID := gen_random_uuid();
  v_heidi             UUID;
  v_ivan              UUID;
  v_ivan_top          UUID := gen_random_uuid();
  v_carol_top2        UUID := gen_random_uuid();
  v_carol_reply_on_top2 UUID := gen_random_uuid();
  v_ivan_reply_on_top2 UUID := gen_random_uuid();
  v_count             INT;
  v_state             TEXT;
  v_denied            BOOLEAN;
  v_accepted          BOOLEAN;
  v_dup_rejected      BOOLEAN := FALSE;
  v_dcount            INT;
  v_preview_only      BOOLEAN;
BEGIN
  v_alice := test_seed_user_500();
  v_bob   := test_seed_user_500();
  v_carol := test_seed_user_500();

  -- Pre-block state: each side has a top-level post and a reply under the
  -- other's post; carol (unrelated third party) reacts on bob's post.
  PERFORM test_become(v_alice);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_a_top, v_alice, 'Alice top', 'alice-top-body');

  PERFORM test_become(v_bob);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_b_top, v_bob, 'Bob top', 'bob-top-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_bob_reply_on_a, v_bob, 'bob-reply-on-a', v_a_top);

  PERFORM test_become(v_alice);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_alice_reply_on_b, v_alice, 'alice-reply-on-b', v_b_top);

  PERFORM test_become(v_carol);
  INSERT INTO collective_reactions (id, post_id, user_id, kind) VALUES (gen_random_uuid(), v_b_top, v_carol, 'heart');

  -- Establish the block: alice blocks bob.
  PERFORM test_become(v_alice);
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);

  -- ------------------------------------------------------------------------
  -- Feed / thread reads exclude the blocked pair's content both directions;
  -- own posts are never hidden.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_b_top;
  PERFORM tap_ok(v_count = 0, 'alice''s feed excludes bob''s post after alice blocks bob');

  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_a_top;
  PERFORM tap_ok(v_count = 1, 'alice''s own post is still returned by her feed after the block (own posts never hidden)');

  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_a_top;
  PERFORM tap_ok(v_count = 0, 'bob''s feed excludes alice''s post — hiding is symmetric');

  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_count FROM collective_thread_root(v_b_top);
  PERFORM tap_ok(v_count = 0, 'alice''s thread_root read of bob''s post returns zero rows');

  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_count FROM collective_thread_root(v_a_top);
  PERFORM tap_ok(v_count = 0, 'bob''s thread_root read of alice''s post returns zero rows');

  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_count FROM collective_thread_page(v_a_top, NULL, 50) WHERE id = v_bob_reply_on_a;
  PERFORM tap_ok(v_count = 0, 'alice''s thread_page read of her own post excludes bob''s pre-existing reply');

  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_count FROM collective_thread_page(v_b_top, NULL, 50) WHERE id = v_alice_reply_on_b;
  PERFORM tap_ok(v_count = 0, 'bob''s thread_page read of his own post excludes alice''s pre-existing reply');

  -- ------------------------------------------------------------------------
  -- Write gates: cross-boundary reply and reaction INSERTs are denied both
  -- directions. A passing result here proves the post-author lookup used by
  -- these policies bypasses collective_posts' own RLS rather than reading
  -- NULL through it.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_alice);
  v_denied := FALSE;
  BEGIN
    INSERT INTO collective_posts (id, user_id, body, parent_post_id)
    VALUES (gen_random_uuid(), v_alice, 'alice-tries-to-reply-to-bob', v_b_top);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'alice cannot INSERT a reply to bob''s post after blocking him');

  PERFORM test_become(v_bob);
  v_denied := FALSE;
  BEGIN
    INSERT INTO collective_posts (id, user_id, body, parent_post_id)
    VALUES (gen_random_uuid(), v_bob, 'bob-tries-to-reply-to-alice', v_a_top);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'bob cannot INSERT a reply to alice''s post while blocked by her');

  PERFORM test_become(v_alice);
  v_denied := FALSE;
  BEGIN
    INSERT INTO collective_reactions (id, post_id, user_id, kind)
    VALUES (gen_random_uuid(), v_b_top, v_alice, 'heart');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'alice cannot INSERT a reaction on bob''s post after blocking him');

  PERFORM test_become(v_bob);
  v_denied := FALSE;
  BEGIN
    INSERT INTO collective_reactions (id, post_id, user_id, kind)
    VALUES (gen_random_uuid(), v_a_top, v_bob, 'heart');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'bob cannot INSERT a reaction on alice''s post while blocked by her');

  -- ------------------------------------------------------------------------
  -- Reaction SELECT: hidden from the blocked-pair viewer, but the row is
  -- proven to genuinely still exist via the post's own (unblocked) author.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_alice);
  SELECT COUNT(*) INTO v_count FROM collective_reactions WHERE post_id = v_b_top;
  PERFORM tap_ok(v_count = 0, 'alice''s direct read of reactions on bob''s post is filtered to zero rows');

  PERFORM test_become(v_bob);
  SELECT COUNT(*) INTO v_count FROM collective_reactions WHERE post_id = v_b_top;
  PERFORM tap_ok(v_count = 1, 'bob (unblocked from himself) sees carol''s pre-existing reaction — the row genuinely exists, it is a real filter');

  -- ------------------------------------------------------------------------
  -- collective_reports is untouched by the block, both directions.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_alice);
  v_accepted := FALSE;
  BEGIN
    INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code)
    VALUES (gen_random_uuid(), v_b_top, v_alice, 'spam');
    v_accepted := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'alice can still report bob''s post despite blocking him');

  PERFORM test_become(v_bob);
  v_accepted := FALSE;
  BEGIN
    INSERT INTO collective_reports (id, post_id, reporter_user_id, reason_code)
    VALUES (gen_random_uuid(), v_a_top, v_bob, 'spam');
    v_accepted := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'bob can still report alice''s post while blocked by her');

  -- ------------------------------------------------------------------------
  -- Duplicate block, unblock liveness, then re-block. The FK-cascade
  -- account-deletion of bob is deferred to the END of this block: deleting
  -- bob tombstones his post/reply (user_id SET NULL) and cascades his report,
  -- which would poison the descendant_count and admin-queue characterizations
  -- below that require bob alive and blocked. It runs last, after all of them.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_alice);
  BEGIN
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);
  EXCEPTION
    WHEN unique_violation THEN v_dup_rejected := TRUE;
  END;
  PERFORM tap_ok(v_dup_rejected, 'a duplicate (alice, bob) block INSERT raises unique_violation');

  DELETE FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_b_top;
  PERFORM tap_ok(v_count = 1, 'bob''s post reappears in alice''s feed immediately after she deletes the block (unblock liveness)');

  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_bob);

  -- ------------------------------------------------------------------------
  -- Tombstoned author: stays visible, replies to them are not denied.
  -- ------------------------------------------------------------------------
  v_erin := test_seed_user_500();
  PERFORM test_become(v_erin);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_t_erin, v_erin, 'Erin top', 'erin-top-body');
  -- Same privileged-account-deletion simulation as above.
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM auth.users WHERE id = v_erin;

  PERFORM test_become(v_carol);
  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_t_erin;
  PERFORM tap_ok(v_count = 1, 'a tombstoned author''s post stays visible (is_blocked_either_way with a NULL author is FALSE)');

  v_accepted := FALSE;
  BEGIN
    INSERT INTO collective_posts (id, user_id, body, parent_post_id)
    VALUES (gen_random_uuid(), v_carol, 'carol-replies-to-tombstoned-post', v_t_erin);
    v_accepted := TRUE;
  EXCEPTION
    WHEN OTHERS THEN v_accepted := FALSE;
  END;
  PERFORM tap_ok(v_accepted, 'a reply to a tombstoned author''s post is not spuriously denied');

  -- ------------------------------------------------------------------------
  -- descendant_count characterization: the recursive walk excludes a
  -- blocked author's reply from the count (filtered-walk resolution), not
  -- merely from the visible row list.
  -- ------------------------------------------------------------------------
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_carol_reply_on_a, v_carol, 'carol-reply-on-a', v_a_top);

  PERFORM test_become(v_alice);
  SELECT descendant_count INTO v_dcount FROM collective_feed_page(NULL, 50) WHERE id = v_a_top;
  PERFORM tap_ok(
    v_dcount = 1,
    'descendant_count on alice''s post counts only carol''s reply, excluding bob''s blocked reply (filtered-walk characterization)'
  );

  -- ------------------------------------------------------------------------
  -- Depth-2 recursion: a blocked author's reply nested UNDER a NON-blocked
  -- author's reply must also be excluded — this exercises the recursive
  -- term of the descendant walk (deeper JOIN collective_posts ... deeper),
  -- not merely the base-case direct-child term the fixture above covers.
  -- Bob may still reply here: the INSERT gate only checks the block between
  -- bob and the DIRECT parent's author (carol, unblocked), not the thread
  -- root's author (alice, who blocks him).
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_bob);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id)
  VALUES (v_bob_reply_on_carol, v_bob, 'bob-reply-nested-under-carol', v_carol_reply_on_a);

  PERFORM test_become(v_alice);
  SELECT descendant_count INTO v_dcount FROM collective_feed_page(NULL, 50) WHERE id = v_a_top;
  PERFORM tap_ok(
    v_dcount = 1,
    'descendant_count on alice''s post still counts only carol''s reply after bob''s depth-2 reply is nested under it (recursive-term exclusion)'
  );

  SELECT COUNT(*) INTO v_count FROM collective_thread_page(v_carol_reply_on_a, NULL, 50) WHERE id = v_bob_reply_on_carol;
  PERFORM tap_ok(v_count = 0, 'alice''s thread_page read of carol''s reply excludes bob''s depth-2 nested reply');

  -- ------------------------------------------------------------------------
  -- Admin moderation RPCs are NOT filtered — they must see everything.
  -- ------------------------------------------------------------------------
  v_admin := test_seed_user();
  PERFORM test_become_admin(v_admin);
  SELECT COUNT(*) INTO v_count FROM collective_moderation_queue(50) WHERE post_id IN (v_a_top, v_b_top);
  PERFORM tap_ok(v_count = 2, 'the admin moderation queue lists both reported posts despite the block between their authors');

  SELECT COUNT(*) INTO v_count FROM collective_post_admin_detail(v_b_top);
  PERFORM tap_ok(v_count = 1, 'the admin post-detail RPC still reaches bob''s post despite the block');

  -- ------------------------------------------------------------------------
  -- your_posts is unaffected by being blocked.
  -- ------------------------------------------------------------------------
  -- Seed a fresh blocked party for this check.
  v_ivan := test_seed_user_500();
  PERFORM test_become(v_alice);
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_alice, v_ivan);

  PERFORM test_become(v_ivan);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_ivan_top, v_ivan, 'Ivan top', 'ivan-top-body');
  SELECT COUNT(*) INTO v_count FROM collective_your_posts_page(NULL, 50) WHERE id = v_ivan_top;
  PERFORM tap_ok(v_count = 1, 'a blocked user''s own-posts read is unaffected by being blocked by someone else');

  -- ------------------------------------------------------------------------
  -- Preview-mode branch: a sub-500 viewer (feed preview mode) still has the
  -- blocked pair's content filtered, not just the full-mode branch.
  -- ------------------------------------------------------------------------
  v_heidi := test_seed_user(); -- deliberately NOT 500-completed: forces preview mode as viewer.
  PERFORM test_become(v_heidi);
  INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (v_heidi, v_ivan);

  SELECT COUNT(*) INTO v_count FROM collective_feed_page(NULL, 50) WHERE id = v_ivan_top;
  PERFORM tap_ok(v_count = 0, 'a sub-500 (preview-mode) viewer''s feed still excludes a blocked author''s post');

  SELECT bool_and(mode = 'preview') INTO v_preview_only FROM collective_feed_page(NULL, 50);
  PERFORM tap_ok(COALESCE(v_preview_only, FALSE), 'the preceding read genuinely exercised the preview-mode branch, not full');

  -- ------------------------------------------------------------------------
  -- Preview-mode branch, thread_page: a sub-500 viewer's thread_page read
  -- also filters a blocked author's reply, not just feed's preview branch
  -- checked above.
  -- ------------------------------------------------------------------------
  PERFORM test_become(v_carol);
  INSERT INTO collective_posts (id, user_id, title, body) VALUES (v_carol_top2, v_carol, 'Carol top2', 'carol-top2-body');
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_carol_reply_on_top2, v_carol, 'carol-reply-on-top2', v_carol_top2);

  PERFORM test_become(v_ivan);
  INSERT INTO collective_posts (id, user_id, body, parent_post_id) VALUES (v_ivan_reply_on_top2, v_ivan, 'ivan-reply-on-carol-top2', v_carol_top2);

  PERFORM test_become(v_heidi);
  SELECT COUNT(*) INTO v_count FROM collective_thread_page(v_carol_top2, NULL, 50) WHERE id = v_ivan_reply_on_top2;
  PERFORM tap_ok(v_count = 0, 'heidi (preview-mode viewer) thread_page excludes ivan''s reply after she blocks him');

  SELECT bool_and(mode = 'preview') INTO v_preview_only FROM collective_thread_page(v_carol_top2, NULL, 50);
  PERFORM tap_ok(COALESCE(v_preview_only, FALSE), 'the preceding thread_page read genuinely exercised the preview-mode branch, not full');

  -- ------------------------------------------------------------------------
  -- FK-cascade account deletion (deferred from the block-liveness section so
  -- it does not tombstone bob's content before the characterizations above).
  -- alice still blocks bob (re-blocked earlier). Account deletion is a
  -- privileged operation — auth.users is not writable by the authenticated
  -- role — so switch to a privileged role to simulate it.
  -- ------------------------------------------------------------------------
  PERFORM set_config('role', 'postgres', true);
  DELETE FROM auth.users WHERE id = v_bob;
  SELECT COUNT(*) INTO v_count FROM user_blocks WHERE blocker_user_id = v_alice AND blocked_user_id = v_bob;
  PERFORM tap_ok(v_count = 0, 'deleting bob''s account hard-deletes the block row naming him (FK cascade)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
