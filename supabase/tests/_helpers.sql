-- _helpers.sql — Shared seeding helpers for Story 3-1 SQL regression suite.
--
-- Loaded implicitly by each t01..t12 test file via \i (psql include) or
-- redefined inline when running under `supabase test db` (pgTAP). pgTAP loads
-- only files matching `t*.sql`, so this file is named with leading `_` to be
-- ignored by the runner — tests `\i _helpers.sql` themselves.
--
-- Each test runs inside a transaction (BEGIN ... ROLLBACK) wrapped by pgTAP,
-- so seeded rows are cleaned up automatically.

-- Seed an auth user + public.users row. Returns the new user id.
CREATE OR REPLACE FUNCTION test_seed_user(p_email TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_uid UUID := gen_random_uuid();
  v_email TEXT := COALESCE(p_email, 'test-' || v_uid::text || '@example.com');
BEGIN
  -- auth.users is the FK target for public.users.
  INSERT INTO auth.users (id, email, instance_id, aud, role)
  VALUES (v_uid, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, encryption_mode, preferences)
  VALUES (v_uid, 'e2e', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  RETURN v_uid;
END;
$$;

-- Seed a daily_entry + flows summing to >= 500 words for today's UTC day.
CREATE OR REPLACE FUNCTION test_seed_500_today(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO daily_entries (id, user_id, entry_date)
  VALUES (v_entry_id, p_user, (NOW() AT TIME ZONE 'UTC')::date)
  ON CONFLICT (user_id, entry_date) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_entry_id;

  -- Re-fetch because ON CONFLICT may have returned an existing entry id.
  SELECT id INTO v_entry_id
  FROM daily_entries
  WHERE user_id = p_user AND entry_date = (NOW() AT TIME ZONE 'UTC')::date;

  INSERT INTO flows (id, daily_entry_id, content, word_count, is_deleted)
  VALUES (gen_random_uuid(), v_entry_id, 'seeded-content', 500, FALSE);
END;
$$;

-- Seed a sub-500 user (entry exists, flow has only 100 words).
CREATE OR REPLACE FUNCTION test_seed_sub500_today(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO daily_entries (id, user_id, entry_date)
  VALUES (v_entry_id, p_user, (NOW() AT TIME ZONE 'UTC')::date)
  ON CONFLICT (user_id, entry_date) DO NOTHING;

  SELECT id INTO v_entry_id
  FROM daily_entries
  WHERE user_id = p_user AND entry_date = (NOW() AT TIME ZONE 'UTC')::date;

  INSERT INTO flows (id, daily_entry_id, content, word_count, is_deleted)
  VALUES (gen_random_uuid(), v_entry_id, 'short', 100, FALSE);
END;
$$;

-- Switch to the authenticated role with a JWT-claim sub set to the given uid.
-- Combines `SET LOCAL role` + `request.jwt.claim.sub` so that auth.uid()
-- returns the seeded user inside SECURITY DEFINER calls.
CREATE OR REPLACE FUNCTION test_become(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION test_become_anon()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
END;
$$;
