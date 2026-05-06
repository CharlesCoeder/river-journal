-- Migration: Create collective_reports table.
-- Both FK ON DELETE behaviors are CASCADE: a deleted post's reports are gone
-- (no reason to retain); an account deletion clears reports authored by that
-- account (the moderation admin queue should never surface reports authored
-- by a now-deleted user).
-- Architecture: D2 (plaintext, server-visible), D7 (TanStack Query domain).

CREATE TABLE collective_reports (
  id                UUID        PRIMARY KEY,
  post_id           UUID        NOT NULL REFERENCES collective_posts(id) ON DELETE CASCADE,
  reporter_user_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_code       TEXT        NOT NULL,
  note              TEXT        NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT collective_reports_post_reporter_key
    UNIQUE (post_id, reporter_user_id)
);

ALTER TABLE collective_reports ENABLE ROW LEVEL SECURITY;
