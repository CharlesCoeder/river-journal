-- supabase/seed.sql — LOCAL-ONLY seed for the Collective UI-parity workflow.
--
-- Runs automatically on `supabase db reset` (see [db.seed] in config.toml).
-- seed.sql is a *local development* mechanism: it is NEVER applied to a remote
-- or production database, so it is safe to fabricate auth users + content here.
--
-- Goal: make `/collective/dev` render the populated, FULL-mode title-led forum
-- WITHOUT a human writing 500 words first, so Playwright can screenshot the
-- real feed for design-parity comparison unattended.
--
-- How eligibility is granted: we seed a real daily_entry + a 500-word flow for
-- the dev user TODAY (the prod-safe path the gate already understands). We do
-- NOT touch collective_dev_bypass() — that allowlist ships to prod and must
-- stay empty (see 20260618000000_add_collective_dev_bypass.sql).
--
-- Fixed identifiers (referenced by docs/collective-parity/seed-session.mjs):
--   dev user id : d0000000-0000-4000-8000-000000000001
--   email       : dev@river.test
--   password    : riverdev123
-- ============================================================================

-- Idempotent: a fresh `db reset` runs migrations then this file on an empty DB,
-- but the ON CONFLICT guards also make a manual re-run safe.

-- 1. Auth user (GoTrue). Empty-string tokens + confirmed email so that
--    signInWithPassword works against the local GoTrue. pgcrypto lives in the
--    `extensions` schema on Supabase, so crypt()/gen_salt() are qualified.
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'dev@river.test',
  extensions.crypt('riverdev123', extensions.gen_salt('bf')), NOW(),
  NOW(), NOW(),
  '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- 2. public.users profile row (FK target for collective_posts.user_id).
INSERT INTO public.users (id, encryption_mode, preferences)
VALUES ('d0000000-0000-4000-8000-000000000001', 'e2e', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 3. Eligibility: a daily_entry + a 500-word flow for TODAY so
--    daily_500_completed_today() returns TRUE => feed/thread RPCs serve FULL.
--    IMPORTANT: date the entry in the USER'S timezone, exactly as
--    daily_500_completed_today() does ((NOW() AT TIME ZONE user.timezone)::date).
--    Dating it in UTC silently breaks eligibility when the seed runs after UTC
--    midnight but before the user's local midnight (e.g. America/New_York), where
--    the UTC date is already "tomorrow" relative to the user's local today.
INSERT INTO daily_entries (id, user_id, entry_date)
VALUES (
  'd0000000-0000-4000-8000-0000000000e1',
  'd0000000-0000-4000-8000-000000000001',
  (
    NOW() AT TIME ZONE COALESCE(
      (SELECT timezone FROM public.users WHERE id = 'd0000000-0000-4000-8000-000000000001'),
      'UTC'
    )
  )::date
)
ON CONFLICT (user_id, entry_date) DO NOTHING;

INSERT INTO flows (id, daily_entry_id, content, word_count, is_deleted)
VALUES (
  'd0000000-0000-4000-8000-0000000000f1',
  'd0000000-0000-4000-8000-0000000000e1',
  'seeded eligibility flow', 500, FALSE
)
ON CONFLICT (id) DO NOTHING;

-- 4. Title-led forum content. Top-level rows carry a title (CHECK requires it);
--    replies carry title = NULL (CHECK forbids it). Spread created_at so the
--    feed ordering is deterministic. Author is the dev user so "Your posts"
--    also has data; vary nothing else — identity display is an open milestone.
--
-- Post ids are stable so reactions + replies can reference them.
INSERT INTO collective_posts (id, user_id, parent_post_id, title, body, created_at) VALUES
  ('a0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001', NULL,
   'On the quiet of early mornings',
   'There is a particular stillness before the city wakes. I have been trying to meet it on purpose lately, coffee in hand, watching the light come up over the rooftops. It rearranges what feels urgent.',
   NOW() - INTERVAL '2 hours'),
  ('a0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000001', NULL,
   'What I learned from keeping a streak',
   'Forty days in and the novelty is gone, which is exactly when it starts to matter. The page stops being a performance and becomes a kind of breathing. Some days I write nothing worth keeping. That is fine.',
   NOW() - INTERVAL '5 hours'),
  ('a0000000-0000-4000-8000-000000000003',
   'd0000000-0000-4000-8000-000000000001', NULL,
   'A question about endings',
   'How do you know when a piece of writing is finished, versus merely abandoned? I keep returning to the same three paragraphs and sanding them smoother, but I am no longer sure I am improving them.',
   NOW() - INTERVAL '1 day'),
  ('a0000000-0000-4000-8000-000000000004',
   'd0000000-0000-4000-8000-000000000001', NULL,
   'Notes on writing badly on purpose',
   'My most useful trick this month: give myself permission to write the worst possible version first. The bad draft is generative in a way the blank page never is.',
   NOW() - INTERVAL '2 days');

-- Branching reply tree under post 1, depth up to 4 to exercise the depth cap +
-- "view N more replies" affordance. parent_post_id chains the depth.
INSERT INTO collective_posts (id, user_id, parent_post_id, title, body, created_at) VALUES
  -- depth 1
  ('b0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', NULL,
   'This is exactly it. The hour before anyone needs anything from me is the only time the noise drops.',
   NOW() - INTERVAL '110 minutes'),
  ('b0000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', NULL,
   'I get the same thing at night, oddly. Same stillness, opposite end of the day.',
   NOW() - INTERVAL '100 minutes'),
  -- depth 2 (reply to b1)
  ('b0000000-0000-4000-8000-000000000003',
   'd0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', NULL,
   'Do you protect that hour deliberately, or does it just happen?',
   NOW() - INTERVAL '95 minutes'),
  -- depth 3 (reply to b3)
  ('b0000000-0000-4000-8000-000000000004',
   'd0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003', NULL,
   'Deliberately now. It used to just happen and then it stopped, so I started guarding it.',
   NOW() - INTERVAL '90 minutes'),
  -- depth 4 (reply to b4) — at/over the ~4 depth cap
  ('b0000000-0000-4000-8000-000000000005',
   'd0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000004', NULL,
   'Guarding it is the whole skill, honestly.',
   NOW() - INTERVAL '85 minutes');

-- 5. Reactions across the five kinds (heart, sparkle, flame, leaf, wave) so the
--    feed tally + thread reaction bar have varied non-zero counts to render.
INSERT INTO collective_reactions (id, post_id, user_id, kind) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'heart'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', NULL, 'sparkle'),
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', NULL, 'leaf'),
  ('c0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'flame'),
  ('c0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000002', NULL, 'heart'),
  ('c0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', NULL, 'wave'),
  ('c0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'sparkle'),
  ('c0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000004', NULL, 'leaf')
ON CONFLICT (id) DO NOTHING;
