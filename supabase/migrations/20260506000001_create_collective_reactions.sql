-- Migration: Create collective_reactions table.
-- Architecture: D2 (plaintext, server-visible), D7 (TanStack Query domain).

CREATE TABLE collective_reactions (
  id         UUID        PRIMARY KEY,
  post_id    UUID        NOT NULL REFERENCES collective_posts(id) ON DELETE CASCADE,
  -- NULLABLE: account-deletion soft-anonymizes reactions to NULL.
  user_id    UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Postgres unique-with-NULL semantics: when user_id IS NULL, multiple
  -- (post_id, NULL, kind) rows are allowed. This is intentional — anonymized
  -- reactions are not deduplicated, and we don't need them to be. Live
  -- reactions (user_id IS NOT NULL) are correctly de-duplicated by this
  -- constraint, which is what the offline-replay idempotency relies on.
  CONSTRAINT collective_reactions_post_user_kind_key
    UNIQUE (post_id, user_id, kind)
);

-- Index for join-back-from-feed-RPC reads (count reactions per post).
CREATE INDEX collective_reactions_post_id_idx
  ON collective_reactions (post_id);

ALTER TABLE collective_reactions ENABLE ROW LEVEL SECURITY;
