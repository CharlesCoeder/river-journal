-- Migration: AFTER INSERT trigger on moderation_actions that fires an async,
-- best-effort pg_net call to the notify_moderation_action Edge Function.
--
-- NON-BLOCKING GUARANTEE (the load-bearing correctness property).
-- The moderation action's own transaction (the DEFINER function that inserted
-- the audit row) MUST commit regardless of the notification side-effect's
-- health. An uncaught error in an AFTER trigger aborts and rolls back the
-- enclosing transaction — which here would roll back the moderation action
-- itself. So this trigger is deliberately best-effort and MUST NOT raise. Two
-- guards, both required:
--   1. IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') — an
--      absent extension is skipped cleanly (mirrors the pg_cron graceful-skip
--      precedent in 20260313000000_create_trusted_browsers.sql). Without this,
--      referencing net.http_post when pg_net is absent would error and abort.
--   2. BEGIN ... EXCEPTION WHEN OTHERS THEN (RAISE LOG, never RAISE EXCEPTION)
--      around net.http_post — swallows any runtime pg_net error.
-- This INVERTS the atomicity posture of the DEFINER moderation functions
-- (20260711000002), whose audit INSERT is deliberately un-caught so a failed
-- audit rolls the destructive action back. There the notification is nothing;
-- here the enclosing txn IS the moderation action and the notification is a
-- droppable side-effect that must degrade gracefully.
--
-- add_note IS EXCLUDED AT THE TRIGGER LEVEL. A private moderator note must
-- never generate a user-facing notification, so the trigger's WHEN clause skips
-- action_type = 'add_note' outright (the function also no-ops it — defense in
-- depth).
--
-- PAYLOAD OMITS note. The JSON body carries id / action_type / target_post_id /
-- target_user_id / reason / metadata / created_at — but NEVER `note` (the
-- private moderator deliberation; the affected user must never receive it).
-- reason IS included (the affected user is entitled to the reason for their own
-- action) but the function never LOGS it.
--
-- ENV-SPECIFIC CONFIG, NEVER HARDCODED. The function base URL and the
-- service-role bearer are read at call time from Vault
-- (vault.decrypted_secrets), with a database-GUC fallback
-- (current_setting('app.settings.*', true), the missing-ok form). Both are set
-- per-environment as a manual ops step — see docs/edge-functions-setup.md.
-- Precedence is deterministic: Vault first, then GUC. The call is SKIPPED
-- unless BOTH the URL and the key resolve to a non-NULL, non-empty value — a
-- half-configured env (URL set, key NULL) must not fire an unauthenticated
-- request that the function rejects 401 (a silent, unobservable drop).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION notify_moderation_action_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_base_url TEXT;
  v_key      TEXT;
  v_url      TEXT;
  v_payload  JSONB;
BEGIN
  -- Guard 1: pg_net must be installed. Absent => skip cleanly so the enclosing
  -- moderation transaction still commits.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN NULL;
  END IF;

  -- Resolve the base URL. Vault first (recommended: the key never sits in
  -- pg_settings), GUC fallback. The Vault lookup is wrapped so an absent vault
  -- schema/table yields NULL rather than erroring.
  BEGIN
    SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets
    WHERE name = 'edge_base_url'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_base_url := NULL;
  END;
  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := current_setting('app.settings.edge_base_url', true);
  END IF;

  -- Resolve the service-role key, same precedence.
  BEGIN
    SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;
  IF v_key IS NULL OR v_key = '' THEN
    v_key := current_setting('app.settings.service_role_key', true);
  END IF;

  -- Guard 2: BOTH must be present + non-empty. Belt-and-suspenders with guard 1.
  IF v_base_url IS NULL OR v_base_url = '' OR v_key IS NULL OR v_key = '' THEN
    RETURN NULL;
  END IF;

  v_url := rtrim(v_base_url, '/') || '/functions/v1/notify_moderation_action';

  -- Payload built from NEW — deliberately EXCLUDES note.
  v_payload := jsonb_build_object(
    'id',             NEW.id,
    'action_type',    NEW.action_type,
    'target_post_id', NEW.target_post_id,
    'target_user_id', NEW.target_user_id,
    'reason',         NEW.reason,
    'metadata',       NEW.metadata,
    'created_at',     NEW.created_at
  );

  -- Best-effort: pg_net enqueues the request and returns immediately (a
  -- background worker performs the HTTP), so this is non-blocking on the
  -- network. Any error here is swallowed so the moderation txn always commits.
  BEGIN
    PERFORM net.http_post(
      url     := v_url,
      body    := v_payload,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'notify_moderation_action_trigger: net.http_post failed (best-effort, swallowed): %', SQLERRM;
  END;

  RETURN NULL;
END;
$$;

-- Trigger functions are invoked by the trigger mechanism, not via EXECUTE, so
-- revoking EXECUTE from PUBLIC does not affect firing — it just prevents direct
-- ad-hoc calls of a SECURITY DEFINER function.
REVOKE EXECUTE ON FUNCTION notify_moderation_action_trigger() FROM PUBLIC;

-- add_note is excluded at the trigger level (a private note never notifies).
CREATE TRIGGER notify_moderation_action_after_insert
  AFTER INSERT ON moderation_actions
  FOR EACH ROW
  WHEN (NEW.action_type <> 'add_note')
  EXECUTE FUNCTION notify_moderation_action_trigger();
