-- Migration: Create user_suspensions table — temporary posting/reacting
-- suspensions applied by moderation.
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- RLS is enabled with:
--   * a SELECT policy that grants read access to admins (JWT claim
--     is_admin = true) OR to the row's own user (auth.uid() = user_id) — a
--     suspended user must be able to see their own suspension for the in-app
--     receipt UX in a later milestone.
--   * NO INSERT / UPDATE / DELETE policy — writes flow exclusively through the
--     SECURITY DEFINER moderation functions (next milestone) running as the
--     table owner. The belt-and-suspenders REVOKE below re-grants SELECT only,
--     so direct client writes fail with insufficient_privilege.
--
-- Scope note: a suspension gates posting and reacting only (kind = 'post_react').
-- Writing and reading always remain available. `kind` is CHECK-constrained to
-- the single MVP value; the CHECK can broaden in a forward migration later.
--
-- user_id is ON DELETE CASCADE: a deleted account's active/expired suspensions
-- carry no ongoing meaning. The account-deletion milestone owns final deletion
-- semantics; if it later needs these rows retained (SET NULL), that is a
-- forward migration.
--
-- Architecture: plaintext, server-visible (opted OUT of the encryption
-- transform); read via TanStack Query in a later milestone, NOT syncedSupabase.

CREATE TABLE user_suspensions (
  -- Server-generated: rows are written only by DEFINER moderation functions,
  -- so the id is defaulted here rather than client-supplied.
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind = 'post_react'),
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at     TIMESTAMPTZ NOT NULL,
  reason      TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index backing is_active_suspension(): active-suspension lookups for a user,
-- newest expiry first.
CREATE INDEX user_suspensions_user_id_ends_at_idx
  ON user_suspensions (user_id, ends_at DESC);

-- Enable Row Level Security. Reads are admin-or-own (policy below); there is NO
-- INSERT/UPDATE/DELETE policy, so those are denied for every client role.
ALTER TABLE user_suspensions ENABLE ROW LEVEL SECURITY;

-- SELECT: admin (JWT claim) OR the row's own user. No JWT carries is_admin
-- until the admin-claim milestone, so admins see nothing until then; the
-- own-read branch is live immediately for the in-app receipt UX.
CREATE POLICY "user_suspensions_select_admin_or_own"
  ON user_suspensions FOR SELECT
  USING (
    (auth.jwt() ->> 'is_admin')::boolean = true
    OR auth.uid() = user_id
  );

-- NO INSERT / UPDATE / DELETE policies — writes flow exclusively through the
-- DEFINER moderation functions (next milestone) running as the table owner.

-- Belt-and-suspenders grants: strip default CRUD grants and re-grant SELECT
-- only. Mirrors collective_posts / moderation_actions hardening.
REVOKE ALL ON TABLE user_suspensions FROM anon, authenticated;
GRANT SELECT ON TABLE user_suspensions TO authenticated;

-- ============================================================================
-- Finalize is_active_suspension() now that user_suspensions exists.
--
-- The predicate (defined in 20260506000003_add_rls_predicate_functions.sql)
-- wrapped its SELECT in `EXCEPTION WHEN undefined_table THEN RETURN FALSE`
-- purely because this table did not exist yet — that migration documents the
-- follow-up DROP+CREATE. The table now exists, so re-declare the function
-- WITHOUT the exception clause. Signature, STABLE, SECURITY DEFINER, pinned
-- search_path, and grants are unchanged; only the now-obsolete guard is
-- removed. The function is already folded into the live collective_posts /
-- collective_reactions INSERT RLS policies (20260506000004) and now returns
-- real results automatically.
-- ============================================================================
CREATE OR REPLACE FUNCTION is_active_suspension(uid UUID, kind_param TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_suspensions
    WHERE user_id = uid
      AND kind = kind_param
      AND ends_at > NOW()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION is_active_suspension(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION is_active_suspension(UUID, TEXT) TO authenticated;
