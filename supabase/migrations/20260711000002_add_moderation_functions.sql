-- Migration: Admin-only SECURITY DEFINER moderation functions.
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- This migration adds the ONLY write path into the append-only moderation
-- audit log (moderation_actions) and the suspension table (user_suspensions):
-- four admin-only SECURITY DEFINER functions —
--   * remove_post        — mark a Collective post removed + resolve its reports
--   * suspend_user       — open a temporary posting/reacting suspension window
--   * add_moderation_note — record a private audit-only note (no state change)
--   * reinstate_post      — clear a post's removal state
--
-- Each function:
--   * runs as the table owner (postgres), so it bypasses the deliberate
--     no-INSERT RLS posture of moderation_actions / user_suspensions;
--   * RE-CHECKS is_admin on the caller's JWT at the top of its body — a
--     defense-in-depth boundary BENEATH the client route gate. `auth.uid()`
--     and `auth.jwt()` still read the CALLER's request.jwt.* session settings
--     inside a DEFINER function (DEFINER changes the privilege role, not the
--     request GUCs), so the claim check reflects who invoked the RPC. No JWT
--     carries is_admin until the admin-claim milestone wires it, so until then
--     these functions correctly deny everyone — expected and fine.
--   * performs its state mutation AND the moderation_actions INSERT within the
--     function body's single implicit transaction — both commit or both roll
--     back. There is deliberately NO inner BEGIN ... EXCEPTION block: catching
--     the audit-INSERT failure would swallow it and defeat the rollback that
--     delivers the atomicity guarantee (no destructive action without an audit
--     row). Mirrors the atomicity note in add_delete_my_post_function.
--   * uses PARAMETERIZED SQL only — parameters are referenced directly in DML
--     (WHERE id = target_post_id, NOW() + (duration_days * INTERVAL '1 day'));
--     no user-controlled text (reason_code / note / kind) is ever concatenated
--     into SQL. This is the SECURITY DEFINER SQL-injection discipline.
--   * pins SET search_path = public, pg_temp (enforced by the dynamic
--     search-path test that sweeps every DEFINER function in public).
--   * REVOKEs EXECUTE FROM PUBLIC and GRANTs it TO authenticated only —
--     granting to authenticated is safe precisely because each function
--     self-checks is_admin.
--
-- Error contract: admins are trusted operators, so — unlike delete_my_post,
-- which uses an ambiguous error to avoid leaking post existence to untrusted
-- callers — these functions raise CLEAR, DISTINCT errors:
--   * 42501 (insufficient_privilege) — caller is not an admin;
--   * 22023 (invalid_parameter_value) — bad input (missing/nonexistent target,
--     out-of-range duration). A distinct, non-42501 code lets callers tell
--     "bad input" from "not authorized".
--
-- Input validation (carried in from the schema milestone's review): because
-- user_suspensions has no CHECK (ends_at > starts_at) and moderation_actions
-- permits NULL targets, these functions enforce those invariants at the write
-- path (duration >= 1 day; target-presence per action_type).

-- ============================================================================
-- remove_post — mark a post removed, log the action, resolve its open reports.
-- ============================================================================
CREATE OR REPLACE FUNCTION remove_post(
  target_post_id UUID,
  reason_code    TEXT,
  custom_note    TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Admin guard (defense-in-depth beneath the client route gate). A missing
  -- claim (NULL) or a non-admin, and an unauthenticated caller, all deny.
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Target-consistency: the post must exist (admins are trusted, so a plain
  -- message is fine — no ambiguous-error masking needed).
  IF target_post_id IS NULL THEN
    RAISE EXCEPTION 'target_post_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM collective_posts WHERE id = target_post_id) THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  -- Atomic block: state change + audit INSERT + report resolution. If the
  -- audit INSERT fails, the UPDATE above rolls back with it.
  UPDATE collective_posts
  SET is_removed     = TRUE,
      removed_reason = reason_code,
      removed_at     = NOW()
  WHERE id = target_post_id;

  INSERT INTO moderation_actions (actor_user_id, action_type, target_post_id, reason, note)
  VALUES (auth.uid(), 'remove_post', target_post_id, reason_code, custom_note);

  UPDATE collective_reports
  SET status = 'reviewed'
  WHERE post_id = target_post_id AND status = 'pending';
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_post(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION remove_post(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- suspend_user — open a temporary posting/reacting suspension + log it.
-- ============================================================================
CREATE OR REPLACE FUNCTION suspend_user(
  target_user_id UUID,
  kind           TEXT,
  duration_days  INT,
  reason         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- Input validation: non-null target, interval >= 1 day (guarantees
  -- ends_at > starts_at and never in the past), and kind matches the table
  -- CHECK (fail fast with a clear message rather than a raw CHECK violation).
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF duration_days IS NULL OR duration_days < 1 THEN
    RAISE EXCEPTION 'duration_days must be at least 1' USING ERRCODE = '22023';
  END IF;
  IF kind IS DISTINCT FROM 'post_react' THEN
    RAISE EXCEPTION 'unsupported suspension kind' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '22023';
  END IF;

  -- Atomic block: suspension row + audit INSERT. starts_at defaults to NOW().
  -- Interval is parameterized (duration_days * INTERVAL '1 day'), never a
  -- string-built literal.
  INSERT INTO user_suspensions (user_id, kind, ends_at, reason)
  VALUES (target_user_id, kind, NOW() + (duration_days * INTERVAL '1 day'), reason);

  INSERT INTO moderation_actions (actor_user_id, action_type, target_user_id, reason, metadata)
  VALUES (
    auth.uid(),
    'suspend_user',
    target_user_id,
    reason,
    jsonb_build_object('kind', kind, 'duration_days', duration_days)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION suspend_user(UUID, TEXT, INT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION suspend_user(UUID, TEXT, INT, TEXT) TO authenticated;

-- ============================================================================
-- add_moderation_note — record a private audit-only note; NO other table
-- changes. Params reordered so the required `note` precedes the defaulted
-- targets (PL/pgSQL forbids a non-defaulted param after a defaulted one);
-- callers use named args, so order is transparent. The written action_type is
-- 'add_note' (the function name differs from the CHECK enum value).
-- ============================================================================
CREATE OR REPLACE FUNCTION add_moderation_note(
  note           TEXT,
  target_post_id UUID DEFAULT NULL,
  target_user_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- A note with no subject is meaningless: require at least one target.
  IF target_post_id IS NULL AND target_user_id IS NULL THEN
    RAISE EXCEPTION 'a note requires a target post or user' USING ERRCODE = '22023';
  END IF;
  IF target_post_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM collective_posts WHERE id = target_post_id) THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;
  IF target_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = target_user_id) THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO moderation_actions (actor_user_id, action_type, target_post_id, target_user_id, note)
  VALUES (auth.uid(), 'add_note', target_post_id, target_user_id, note);
END;
$$;

-- Argtypes match the DECLARED parameter order exactly: (TEXT, UUID, UUID).
-- Postgres resolves REVOKE/GRANT ON FUNCTION by exact positional signature.
REVOKE EXECUTE ON FUNCTION add_moderation_note(TEXT, UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION add_moderation_note(TEXT, UUID, UUID) TO authenticated;

-- ============================================================================
-- reinstate_post — clear a post's removal state + log it.
-- ============================================================================
CREATE OR REPLACE FUNCTION reinstate_post(
  target_post_id UUID,
  reason         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR (auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF target_post_id IS NULL THEN
    RAISE EXCEPTION 'target_post_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM collective_posts WHERE id = target_post_id) THEN
    RAISE EXCEPTION 'post not found' USING ERRCODE = '22023';
  END IF;

  -- Atomic block: state change + audit INSERT.
  UPDATE collective_posts
  SET is_removed     = FALSE,
      removed_reason = NULL,
      removed_at     = NULL
  WHERE id = target_post_id;

  INSERT INTO moderation_actions (actor_user_id, action_type, target_post_id, reason)
  VALUES (auth.uid(), 'reinstate', target_post_id, reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION reinstate_post(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION reinstate_post(UUID, TEXT) TO authenticated;
