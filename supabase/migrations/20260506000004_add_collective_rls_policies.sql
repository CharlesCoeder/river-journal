-- Migration: RLS policies for the three Collective tables.
--
-- Sequenced strictly AFTER the predicate-function migration so policies
-- referencing daily_500_completed_today() / is_active_suspension() compile
-- cleanly.
--
-- Architecture: D5 (server-side RLS posting gate — daily_500_completed_today
--                   + is_active_suspension are the only authoritative checks).

-- ============================================================================
-- collective_posts
-- ============================================================================
-- NO SELECT policy is created. RLS is enabled; with no SELECT policy granting
-- access, all direct SELECTs are denied. Reads flow through the SECURITY
-- DEFINER RPCs in 20260506000006_add_collective_read_rpcs.sql.
--
-- NO UPDATE policy. Updates are denied via RLS. delete_my_post (DEFINER,
-- 20260506000005) bypasses RLS for the soft-delete; future moderation
-- functions will do the same for is_removed = TRUE.
--
-- NO DELETE policy. Hard-deletes are denied at the policy level.

CREATE POLICY "collective_posts_insert_gated"
  ON collective_posts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND daily_500_completed_today(auth.uid())
    AND NOT is_active_suspension(auth.uid(), 'post_react')
  );

-- ============================================================================
-- collective_reactions
-- ============================================================================
-- SELECT open to authenticated: previewed posts and full-feed posts both
-- show real reaction counts.
CREATE POLICY "collective_reactions_select_authenticated"
  ON collective_reactions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- INSERT gated identically to posts.
CREATE POLICY "collective_reactions_insert_gated"
  ON collective_reactions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND daily_500_completed_today(auth.uid())
    AND NOT is_active_suspension(auth.uid(), 'post_react')
  );

-- DELETE: reactor can undo their own reaction at any time (no gate on undo;
-- if their streak lapsed, they can still remove an existing reaction).
CREATE POLICY "collective_reactions_delete_own"
  ON collective_reactions FOR DELETE
  USING (auth.uid() = user_id);

-- NO UPDATE policy — reactions are insert/delete only.

-- ============================================================================
-- collective_reports
-- ============================================================================
-- INSERT: any authenticated user (no 500-gate — sub-500 viewers must be able
-- to report a problematic post they see in the preview).
CREATE POLICY "collective_reports_insert_own"
  ON collective_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_user_id);

-- SELECT: admin-only via JWT claim. The is_admin claim wiring lands in a
-- later moderation milestone; until then no JWT carries the claim and the
-- policy correctly denies all reads.
CREATE POLICY "collective_reports_select_admin"
  ON collective_reports FOR SELECT
  USING ((auth.jwt() ->> 'is_admin')::boolean = true);

-- NO UPDATE/DELETE policies — reports are append-only from the user side;
-- status updates land later via DEFINER moderation functions.
