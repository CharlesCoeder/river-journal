-- Migration: delete_my_post(post_id UUID) RETURNS VOID — user self-delete.
--
-- SECURITY DEFINER bypasses the RLS UPDATE-deny / DELETE-deny on
-- collective_posts to perform a soft delete + reaction cleanup atomically.
--
-- Ambiguous-error principle: the SAME SQLSTATE ('42501') and SAME message
-- ('cannot delete this post') are raised for ALL three failure cases:
--   - post does not exist
--   - post exists but caller is not the owner
--   - post exists, caller IS owner, but post is already user-deleted
-- Do NOT change the message between cases — leaking which case fired
-- would tell an attacker whether a post_id exists / whether they're the
-- owner. The within-process timing leak (UPDATE+DELETE path is measurably
-- slower than the early-return failure path) is an accepted residual risk
-- below the v2 threat-model floor.
--
-- Idempotency: a client retrying a successful delete hits the
-- is_user_deleted = FALSE precondition and gets the ambiguous-error
-- response. The client treats this specific error as success when local
-- optimistic state already shows deleted.
--
-- This function does NOT insert into moderation_actions — user self-delete
-- is a data-rights action, not a moderation action.

CREATE OR REPLACE FUNCTION delete_my_post(post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Alias the input parameter to a local variable so we can reference the
  -- caller-supplied id from DML against tables that also have a `post_id`
  -- column (notably collective_reactions). The `#variable_conflict use_column`
  -- directive resolves bare `post_id` references to the table column, while
  -- `v_post_id` carries the parameter value into WHERE clauses unambiguously.
  v_post_id UUID := post_id;
  v_owner UUID;
  v_already_deleted BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'cannot delete this post' USING ERRCODE = '42501';
  END IF;

  SELECT cp.user_id, cp.is_user_deleted
  INTO v_owner, v_already_deleted
  FROM collective_posts cp
  WHERE cp.id = v_post_id;

  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid() OR v_already_deleted IS TRUE THEN
    RAISE EXCEPTION 'cannot delete this post' USING ERRCODE = '42501';
  END IF;

  -- Atomic: function bodies are a single transaction by default. If either
  -- statement fails, the prior one rolls back.
  UPDATE collective_posts
  SET body = '[deleted]',
      is_user_deleted = TRUE,
      user_deleted_at = NOW()
  WHERE id = v_post_id;

  DELETE FROM collective_reactions
  WHERE post_id = v_post_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION delete_my_post(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_my_post(UUID) TO authenticated;
