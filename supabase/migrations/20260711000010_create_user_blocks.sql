-- Migration: Create user_blocks table — symmetric, silent, server-enforced
-- user-to-user blocking.
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- RLS is enabled and DELIBERATELY ONE-SIDED so the boundary stays silent to
-- the blocked party:
--   * SELECT / INSERT / DELETE policies each permit the action ONLY when
--     auth.uid() = blocker_user_id. A user can list, create, and remove ONLY
--     their own blocks. Nobody can block on someone else's behalf, and the
--     blocked party can never SELECT a row naming them as blocked_user_id —
--     they get zero rows, so the block is undetectable from this table.
--   * NO UPDATE policy exists. Rows are immutable: unblock is a DELETE,
--     re-block is a fresh INSERT (there is no updated_at column). The
--     belt-and-suspenders REVOKE below re-grants SELECT/INSERT/DELETE only,
--     never UPDATE.
--
-- Symmetric enforcement is NOT done here — it lives in the SECURITY DEFINER
-- predicate (next migration) which, running as the table owner, can see a
-- block in EITHER direction (including rows where the caller is the blocked
-- party, which this one-sided RLS hides from their own reads). That dual
-- arrangement is what makes blocking both symmetric AND silent.
--
-- Both FK columns are ON DELETE CASCADE: a block naming a deleted account is
-- meaningless, so deleting a users row hard-deletes every block row where that
-- user appears as blocker OR blocked, in both directions, automatically. No
-- account-deletion saga special-casing is required.
--
-- Architecture: plaintext, server-visible (opted OUT of the encryption
-- transform); managed via TanStack Query in a later milestone, NOT
-- syncedSupabase.

CREATE TABLE user_blocks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A block is idempotent: at most one row per (blocker, blocked) pair.
  CONSTRAINT user_blocks_blocker_blocked_key UNIQUE (blocker_user_id, blocked_user_id),
  -- A user cannot block themselves; keeps is_blocked_either_way(uid, uid)
  -- meaningful and stops a self-block from ever hiding own content.
  CONSTRAINT user_blocks_no_self_block CHECK (blocker_user_id <> blocked_user_id)
);

-- Backs the blocked-users list screen (a blocker's own rows, newest first).
CREATE INDEX user_blocks_blocker_created_at_idx
  ON user_blocks (blocker_user_id, created_at DESC);

-- Backs the reverse-direction probe of the symmetric predicate — the
-- (blocked = a, blocker = b) term the UNIQUE (blocker, blocked) index cannot
-- serve. Keeps the predicate index-backed on the feed/thread hot path.
CREATE INDEX user_blocks_reverse_idx
  ON user_blocks (blocked_user_id, blocker_user_id);

-- Enable Row Level Security. The three own-only policies below are the only
-- grants of access; with RLS enabled and no broader policy, everything else
-- is denied.
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;

-- SELECT: a user sees ONLY the blocks they created. The blocked party sees
-- nothing naming them — the silent invariant.
CREATE POLICY "user_blocks_select_own"
  ON user_blocks FOR SELECT
  USING (auth.uid() = blocker_user_id);

-- INSERT: a user can only create blocks where they are the blocker (cannot
-- block on someone else's behalf).
CREATE POLICY "user_blocks_insert_own"
  ON user_blocks FOR INSERT
  WITH CHECK (auth.uid() = blocker_user_id);

-- DELETE: a user can only remove their own blocks (own unblocks only).
CREATE POLICY "user_blocks_delete_own"
  ON user_blocks FOR DELETE
  USING (auth.uid() = blocker_user_id);

-- NO UPDATE policy — rows are immutable.

-- Belt-and-suspenders grants: strip default CRUD grants and re-grant
-- SELECT/INSERT/DELETE only (deliberately no UPDATE). anon gets nothing.
REVOKE ALL ON TABLE user_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE user_blocks TO authenticated;
