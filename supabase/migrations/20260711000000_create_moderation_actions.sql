-- Migration: Create moderation_actions table — the append-only moderation
-- audit log (the structural backbone of the accountability guarantee: no
-- destructive moderation action can exist without a corresponding, immutable
-- audit row).
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- This table is a PERMANENTLY APPEND-ONLY audit trail. RLS is enabled with:
--   * a SELECT policy that grants read access ONLY to admins (JWT claim
--     is_admin = true — the same idiom as collective_reports_select_admin);
--   * NO INSERT policy — every client role is denied direct writes. The only
--     write path is the SECURITY DEFINER moderation functions added in the
--     next moderation milestone, which run as the table owner (postgres) and
--     therefore bypass RLS. Those functions only ever INSERT here.
--   * NO UPDATE and NO DELETE policy — ever. Combined with the belt-and-
--     suspenders REVOKE below (authenticated is re-granted SELECT only), any
--     UPDATE/DELETE from any non-owner role fails with insufficient_privilege.
--     This is what makes the audit log immutable on every path.
--
-- Actor/target FKs are ON DELETE SET NULL, NEVER CASCADE. When an account is
-- deleted (the account-deletion milestone), its moderation rows must be
-- anonymized — actor/target set to NULL — but the audit row itself must
-- survive. Cascade-deleting the trail would defeat the entire point of an
-- accountability log.
--
-- Architecture: plaintext, server-visible (opted OUT of the encryption
-- transform); reads land in the TanStack Query domain in a later milestone,
-- NOT syncedSupabase.

CREATE TABLE moderation_actions (
  -- Server-generated: rows are written only by DEFINER moderation functions,
  -- so the id is defaulted here rather than client-supplied.
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE + ON DELETE SET NULL: anonymize a deleted moderator without ever
  -- erasing the audit row.
  actor_user_id   UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  action_type     TEXT        NOT NULL
                  CHECK (action_type IN ('remove_post', 'suspend_user', 'add_note', 'reinstate')),
  -- Post hard-delete is currently unused (deletes are soft), but a null-safe
  -- FK keeps the audit row intact if a target post is ever hard-deleted.
  target_post_id  UUID        NULL REFERENCES collective_posts(id) ON DELETE SET NULL,
  -- Same reasoning as actor_user_id: the action still happened even after the
  -- target account is anonymized.
  target_user_id  UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT        NULL,
  note            TEXT        NULL,
  metadata        JSONB       NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes: per-target time-series lookups (moderation history for a given post
-- or user, newest first) and the audit-log firehose view (all actions, newest
-- first).
CREATE INDEX moderation_actions_target_post_id_created_at_idx
  ON moderation_actions (target_post_id, created_at DESC);

CREATE INDEX moderation_actions_target_user_id_created_at_idx
  ON moderation_actions (target_user_id, created_at DESC);

CREATE INDEX moderation_actions_created_at_idx
  ON moderation_actions (created_at DESC);

-- Enable Row Level Security. Reads are admin-only (policy below); there is NO
-- INSERT/UPDATE/DELETE policy, so those operations are denied for every client
-- role at the RLS layer, and additionally at the GRANT layer below.
ALTER TABLE moderation_actions ENABLE ROW LEVEL SECURITY;

-- SELECT: admin-only via JWT claim. No JWT carries is_admin until the admin-
-- claim milestone wires it, so this policy correctly denies all reads until
-- then. Reuses the exact idiom from collective_reports_select_admin.
CREATE POLICY "moderation_actions_select_admin"
  ON moderation_actions FOR SELECT
  USING ((auth.jwt() ->> 'is_admin')::boolean = true);

-- NO INSERT / UPDATE / DELETE policies — deliberate and permanent.
--   * INSERT: writes flow exclusively through the DEFINER moderation functions
--     (added in the next milestone) running as the table owner.
--   * UPDATE / DELETE: permanently denied. This table is append-only; nothing
--     — no policy and no function — is ever allowed to mutate or remove an
--     audit row.

-- Belt-and-suspenders grants: strip Supabase's default CRUD grants and re-grant
-- SELECT only. RLS still narrows SELECT to admins; the DEFINER functions retain
-- write via postgres table ownership. Because authenticated/anon hold no
-- INSERT/UPDATE/DELETE grant, direct writes fail with insufficient_privilege
-- even if RLS were ever toggled off. Mirrors collective_posts hardening.
REVOKE ALL ON TABLE moderation_actions FROM anon, authenticated;
GRANT SELECT ON TABLE moderation_actions TO authenticated;
