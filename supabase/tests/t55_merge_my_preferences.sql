-- t55: merge_my_preferences merges a caller's preference patch into their own
-- users.preferences row, atomically and without clobbering sibling keys.
--
-- Coverage map:
--   A. privileges — anon cannot execute; an unauthenticated call (no sub)
--      raises 42501.
--   B. merge semantics — nested objects merge (siblings survive), scalars
--      replace, JSON null is stored (not deleted), two sequential patches to
--      different keys both survive.
--   C. grow-only arrays — unlockedThemes / locallyHiddenPosts union in order,
--      without duplicates; any other array replaces.
--   D. feature_flags is stripped from the patch (server-seeded, read-only).
--   E. an empty patch is a pure read (returns the doc, leaves updated_at).
--   F. scoping — a caller only ever touches their own row.
--   G. input guards — non-object and oversize patches raise 22023.

BEGIN;
\i _helpers.psql
SELECT plan(18);

-- ==========================================================================
-- A. Privileges.
-- ==========================================================================
DO $$
BEGIN
  PERFORM tap_ok(
    NOT has_function_privilege('anon', 'public.merge_my_preferences(jsonb)', 'EXECUTE'),
    'anon cannot execute merge_my_preferences'
  );
  PERFORM tap_ok(
    has_function_privilege('authenticated', 'public.merge_my_preferences(jsonb)', 'EXECUTE'),
    'authenticated can execute merge_my_preferences'
  );
END;
$$;

DO $$
DECLARE
  v_state TEXT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM merge_my_preferences('{"word_goal": 500}'::jsonb);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  RESET ROLE;
  PERFORM tap_ok(v_state = '42501', format('a call with no auth.uid() raises 42501 (got %s)', v_state));
END;
$$;

-- ==========================================================================
-- B–F. Behavior, as a signed-in user.
-- ==========================================================================
DO $$
DECLARE
  v_me       UUID := test_seed_user();
  v_other    UUID := test_seed_user();
  v_doc      JSONB;
  v_before   TIMESTAMPTZ;
  v_after    TIMESTAMPTZ;
BEGIN
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object(
      'streak', jsonb_build_object('enabled', true, 'local_time', '20:00'),
      'replies', jsonb_build_object('enabled', false)
    ),
    'unlockedThemes', jsonb_build_array('night', 'leather'),
    'feature_flags', jsonb_build_object('external_billing_link_enabled', false)
  )
  WHERE id = v_me;
  UPDATE users SET preferences = '{"word_goal": 111}'::jsonb WHERE id = v_other;

  PERFORM test_become(v_me);

  -- B. Nested merge keeps siblings; scalar replaces.
  v_doc := merge_my_preferences(
    '{"reminders": {"streak": {"local_time": "07:30"}}}'::jsonb
  );
  PERFORM tap_ok(
    v_doc #>> '{reminders,streak,local_time}' = '07:30',
    'a nested scalar in the patch replaces the stored value'
  );
  PERFORM tap_ok(
    (v_doc #> '{reminders,streak,enabled}') = 'true'::jsonb
      AND (v_doc #> '{reminders,replies,enabled}') = 'false'::jsonb,
    'sibling keys at every level survive a nested patch'
  );

  -- B. Two patches to different keys both survive.
  PERFORM merge_my_preferences('{"appearance": {"themeName": "night"}}'::jsonb);
  v_doc := merge_my_preferences('{"word_goal": 1000}'::jsonb);
  PERFORM tap_ok(
    v_doc #>> '{appearance,themeName}' = 'night' AND (v_doc -> 'word_goal') = '1000'::jsonb,
    'sequential patches to different keys both land'
  );

  -- B. JSON null is stored, not treated as a delete.
  v_doc := merge_my_preferences('{"appearance": {"customTheme": null}}'::jsonb);
  PERFORM tap_ok(
    (v_doc -> 'appearance') ? 'customTheme'
      AND jsonb_typeof(v_doc #> '{appearance,customTheme}') = 'null'
      AND v_doc #>> '{appearance,themeName}' = 'night',
    'a JSON null leaf is stored as null and does not drop siblings'
  );

  -- C. Grow-only arrays union in order without duplicates.
  v_doc := merge_my_preferences('{"unlockedThemes": ["leather", "fireside"]}'::jsonb);
  PERFORM tap_ok(
    (v_doc -> 'unlockedThemes') = '["night", "leather", "fireside"]'::jsonb,
    format('unlockedThemes unions in order (got %s)', v_doc -> 'unlockedThemes')
  );
  PERFORM merge_my_preferences('{"locallyHiddenPosts": ["p1"]}'::jsonb);
  v_doc := merge_my_preferences('{"locallyHiddenPosts": ["p2", "p1"]}'::jsonb);
  PERFORM tap_ok(
    (v_doc -> 'locallyHiddenPosts') = '["p1", "p2"]'::jsonb,
    format('locallyHiddenPosts unions without duplicates (got %s)', v_doc -> 'locallyHiddenPosts')
  );

  -- C. Any other array replaces.
  PERFORM merge_my_preferences('{"misc": {"list": [1, 2]}}'::jsonb);
  v_doc := merge_my_preferences('{"misc": {"list": [3]}}'::jsonb);
  PERFORM tap_ok(
    (v_doc #> '{misc,list}') = '[3]'::jsonb,
    'a non-union array is replaced, not merged'
  );

  -- D. feature_flags is stripped.
  v_doc := merge_my_preferences(
    '{"feature_flags": {"external_billing_link_enabled": true}, "word_goal": 750}'::jsonb
  );
  PERFORM tap_ok(
    (v_doc #> '{feature_flags,external_billing_link_enabled}') = 'false'::jsonb
      AND (v_doc -> 'word_goal') = '750'::jsonb,
    'feature_flags in a patch is ignored while the rest of the patch applies'
  );

  -- E. Empty patch is a pure read.
  RESET ROLE;
  UPDATE users SET updated_at = '2000-01-01T00:00:00Z' WHERE id = v_me;
  SELECT updated_at INTO v_before FROM users WHERE id = v_me;
  PERFORM test_become(v_me);
  v_doc := merge_my_preferences('{}'::jsonb);
  RESET ROLE;
  SELECT updated_at INTO v_after FROM users WHERE id = v_me;
  PERFORM tap_ok(
    (v_doc -> 'word_goal') = '750'::jsonb,
    'an empty patch returns the current document'
  );
  PERFORM tap_ok(
    v_after = v_before,
    'an empty patch does not write the row (updated_at unchanged)'
  );

  -- F. Scoping: the other user's row is untouched.
  PERFORM tap_ok(
    (SELECT preferences FROM users WHERE id = v_other) = '{"word_goal": 111}'::jsonb,
    'merges only ever touch the caller''s own row'
  );
END;
$$;

-- ==========================================================================
-- G. Input guards.
-- ==========================================================================
DO $$
DECLARE
  v_me    UUID := test_seed_user();
  v_state TEXT;
BEGIN
  PERFORM test_become(v_me);

  BEGIN
    PERFORM merge_my_preferences('["not", "an", "object"]'::jsonb);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  PERFORM tap_ok(v_state = '22023', format('a non-object patch raises 22023 (got %s)', v_state));

  BEGIN
    PERFORM merge_my_preferences(NULL);
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  PERFORM tap_ok(v_state = '22023', format('a NULL patch raises 22023 (got %s)', v_state));

  BEGIN
    PERFORM merge_my_preferences(jsonb_build_object('blob', repeat('x', 70000)));
    v_state := 'no error';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  PERFORM tap_ok(v_state = '22023', format('a patch over 64 KiB raises 22023 (got %s)', v_state));

  RESET ROLE;
  PERFORM tap_ok(
    (SELECT preferences FROM users WHERE id = v_me) = '{}'::jsonb,
    'rejected patches leave the row unchanged'
  );
END;
$$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
