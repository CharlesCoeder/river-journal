-- t35: the custom access-token hook promotes `is_admin` from the caller's
-- app-level metadata to a TOP-LEVEL claim at token issuance, and only from
-- that source.
--
-- Server-side admin checks read the top-level claim via
-- `auth.jwt() ->> 'is_admin'`. Supabase nests custom metadata under the
-- `app_metadata` claim by default, so without this hook every admin check
-- reads NULL and denies. The hook reads the value from
-- `event->'claims'->'app_metadata'` and, when it is exactly `true`, sets a
-- top-level `is_admin` claim on the returned event. Absent or falsy input
-- leaves the top-level claim unset (absent is the deny default the calling
-- idiom already handles).
--
-- Security-negative coverage:
--   - `app_metadata` is populated exclusively from service-role writes; an
--     event carrying `is_admin: true` under the user-writable `user_metadata`
--     bag instead must NOT be promoted. Promoting from that bag would let any
--     account self-grant admin via a normal profile-update call.
--   - the hook must be callable only by the auth server: `authenticated` and
--     `anon` must have no EXECUTE privilege on it.
--
-- The hook promotes ONLY a real JSON boolean `true` found at
-- `app_metadata.is_admin`. Any other shape — the value absent, `false`, a
-- JSON string `"true"`, a non-object `app_metadata`, or an entirely missing
-- `claims` object — leaves the top-level claim unset and returns without
-- error, since the hook must never throw on a malformed event (that would
-- take down authentication for the caller, not just the admin path).

BEGIN;
\i _helpers.psql
SELECT plan(11);

DO $$
DECLARE
  v_original_app_metadata JSONB := jsonb_build_object('is_admin', true, 'other_field', 'preserved');
  v_result_promote        JSONB;
  v_result_absent         JSONB;
  v_result_explicit_false JSONB;
  v_result_self_grant     JSONB;
  v_event_no_claims       JSONB;
  v_result_no_claims      JSONB;
  v_result_scalar_meta    JSONB;
  v_result_string_true    JSONB;
  v_event_with_siblings   JSONB;
  v_result_with_siblings  JSONB;
BEGIN
  -- Promotion: app_metadata.is_admin = true -> top-level claims.is_admin = true.
  v_result_promote := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000001',
      'claims', jsonb_build_object('app_metadata', v_original_app_metadata)
    )
  );
  PERFORM tap_ok(
    (v_result_promote -> 'claims' ->> 'is_admin') = 'true',
    'app_metadata.is_admin:true is promoted to a top-level claim'
  );

  PERFORM tap_ok(
    (v_result_promote -> 'claims' -> 'app_metadata') = v_original_app_metadata,
    'the original app_metadata sub-object is preserved unchanged after promotion'
  );

  -- Absent app_metadata.is_admin -> no top-level claim written.
  v_result_absent := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000002',
      'claims', jsonb_build_object('app_metadata', jsonb_build_object('unrelated_key', 'value'))
    )
  );
  PERFORM tap_ok(
    COALESCE(v_result_absent -> 'claims' ->> 'is_admin', 'false') <> 'true',
    'a missing app_metadata.is_admin leaves the top-level claim unset'
  );

  -- Explicit app_metadata.is_admin:false -> also not promoted (never write false).
  v_result_explicit_false := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000003',
      'claims', jsonb_build_object('app_metadata', jsonb_build_object('is_admin', false))
    )
  );
  PERFORM tap_ok(
    COALESCE(v_result_explicit_false -> 'claims' ->> 'is_admin', 'false') <> 'true',
    'an explicit app_metadata.is_admin:false leaves the top-level claim unset'
  );

  -- Self-grant guard: is_admin under user-writable metadata must never promote.
  v_result_self_grant := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000004',
      'claims', jsonb_build_object('user_metadata', jsonb_build_object('is_admin', true))
    )
  );
  PERFORM tap_ok(
    COALESCE(v_result_self_grant -> 'claims' ->> 'is_admin', 'false') <> 'true',
    'is_admin:true under user-writable metadata is never promoted to a top-level claim'
  );

  -- Claims entirely absent -> the event is returned unchanged, no error.
  v_event_no_claims := jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000005');
  v_result_no_claims := public.custom_access_token_hook(v_event_no_claims);
  PERFORM tap_ok(
    v_result_no_claims = v_event_no_claims,
    'an event with no claims object at all is returned unchanged'
  );

  -- app_metadata is a non-object scalar -> no promotion, no error.
  v_result_scalar_meta := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000006',
      'claims', jsonb_build_object('app_metadata', to_jsonb('not-an-object'::text))
    )
  );
  PERFORM tap_ok(
    COALESCE(v_result_scalar_meta -> 'claims' ->> 'is_admin', 'false') <> 'true',
    'a non-object app_metadata scalar is not promoted and does not error'
  );

  -- app_metadata.is_admin as the JSON STRING "true" -> NOT promoted (strict
  -- boolean comparison; a string "true" must never satisfy the check).
  v_result_string_true := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-000000000007',
      'claims', jsonb_build_object('app_metadata', jsonb_build_object('is_admin', 'true'))
    )
  );
  PERFORM tap_ok(
    COALESCE(v_result_string_true -> 'claims' ->> 'is_admin', 'false') <> 'true',
    'app_metadata.is_admin as the JSON string "true" is not promoted'
  );

  -- Sibling top-level claims (e.g. sub/role) survive the promotion branch.
  v_event_with_siblings := jsonb_build_object(
    'user_id', '00000000-0000-0000-0000-000000000008',
    'claims', jsonb_build_object(
      'sub', '00000000-0000-0000-0000-000000000008',
      'role', 'authenticated',
      'app_metadata', v_original_app_metadata
    )
  );
  v_result_with_siblings := public.custom_access_token_hook(v_event_with_siblings);
  PERFORM tap_ok(
    (v_result_with_siblings -> 'claims' ->> 'sub') = '00000000-0000-0000-0000-000000000008'
      AND (v_result_with_siblings -> 'claims' ->> 'role') = 'authenticated'
      AND (v_result_with_siblings -> 'claims' ->> 'is_admin') = 'true',
    'sibling top-level claims (sub, role) are preserved alongside the promoted is_admin claim'
  );

  -- Least privilege: end-user roles cannot invoke the hook to forge claims.
  PERFORM tap_ok(
    NOT has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
    'the authenticated role has no EXECUTE privilege on the hook'
  );
  PERFORM tap_ok(
    NOT has_function_privilege('anon', 'public.custom_access_token_hook(jsonb)', 'EXECUTE'),
    'the anon role has no EXECUTE privilege on the hook'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
