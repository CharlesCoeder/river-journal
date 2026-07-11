-- Migration: Custom Access Token Hook — promote `is_admin` to a top-level claim.
--
-- SECURITY MODEL — READ THIS BEFORE EDITING.
-- Supabase surfaces `raw_app_meta_data` only under the `app_metadata` JWT claim
-- by default. Server-side admin checks read the TOP-LEVEL `is_admin` claim
-- (`auth.jwt() ->> 'is_admin'`), so this hook promotes `is_admin` from
-- `app_metadata` to the token root at issuance. Without it, every admin RLS
-- policy and SECURITY DEFINER function reads NULL and denies.
--
-- 🔴 PRIVILEGE-ESCALATION GUARD: the hook reads `is_admin` EXCLUSIVELY from
-- `event->'claims'->'app_metadata'`. `app_metadata` (`raw_app_meta_data`) is
-- writable only by the service role. It must NEVER read from `user_metadata`
-- (`raw_user_meta_data`), which is end-user-writable via
-- `auth.updateUser({ data })` — promoting from there would let any account
-- self-grant admin and own the entire moderation surface.
--
-- BLAST RADIUS: a malformed function name/grant makes GoTrue fail to resolve
-- the hook at startup, taking down ALL authentication, not just the admin path.
-- This migration (function + grants) must apply cleanly BEFORE config.toml
-- enables the hook uri.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claims jsonb;
BEGIN
  claims := event -> 'claims';

  -- 🔴 Read ONLY from app_metadata (service-role-only). NEVER user_metadata,
  -- which is end-user-writable and would allow self-granting admin.
  IF (event -> 'claims' -> 'app_metadata' -> 'is_admin') = 'true'::jsonb THEN
    claims := jsonb_set(claims, '{is_admin}', 'true'::jsonb);
    RETURN jsonb_set(event, '{claims}', claims);
  END IF;

  -- Absent / falsy: leave the top-level claim unset (absent = deny, which the
  -- `(auth.jwt() ->> 'is_admin')::boolean IS DISTINCT FROM true` idiom handles).
  RETURN event;
END;
$$;

-- Auth-hook grant convention: the hook must be callable ONLY by the auth
-- server, never by end users.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
