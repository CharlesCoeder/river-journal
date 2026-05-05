-- Migration: Extend users.preferences JSONB with unlockedThemes (user-chosen unlock tokens)
-- Adds the `unlockedThemes` JSONB array key on `users.preferences` for streak-driven
-- theme unlocks. Idempotent: re-running is a no-op on rows where the key already exists.
-- Purely additive — no column drop, no NOT NULL added, no schema breakage.
--
-- Shape extension on users.preferences (JSONB):
--   { ...existing keys,
--     unlockedThemes: string[]  // ThemeName[] — themes the user has spent unlock tokens on
--   }
--
-- Reads/writes happen client-side via Legend-State today; this migration exists so the
-- column shape is documented and so a future server-side sync wire-up has a known
-- starting state on existing rows. The client tolerates rows where the key is absent
-- (treated as []).

-- Optional read-side consistency backfill: ensure existing rows have unlockedThemes = []
-- when not present. Safe (no-op on rows that already have the key).
UPDATE users
SET preferences = jsonb_set(
  preferences,
  '{unlockedThemes}',
  '[]'::jsonb,
  true  -- create_missing
)
WHERE NOT (preferences ? 'unlockedThemes');
