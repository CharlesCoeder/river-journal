-- Migration: reply-notification substrate — the upward thread-root resolver,
-- the service-role-only recipient-eligibility filter (block + preference gate),
-- the per-reply idempotency ledger, and the best-effort AFTER INSERT trigger
-- that dispatches an async pg_net call to the notify_reply Edge Function.
--
-- Four pieces, in dependency order:
--   1. thread_root_user_id(post_id) — resolves the author of a thread's root
--      post by walking UP the parent_post_id chain. This is the OPPOSITE
--      direction of collective_thread_root (which walks DOWN to enumerate
--      descendants). It reuses the CYCLE-guarded recursive-CTE idiom but must
--      never confuse the two directions.
--   2. notify_reply_eligible_recipients(candidate_ids, replier_id) — the
--      service-role-only filter that folds the symmetric block predicate
--      (private.is_blocked_either_way) and the replies-notification preference
--      gate into one pass. The block predicate lives in the `private` schema,
--      which PostgREST never exposes, so the Edge Function's HTTP/service-role
--      client genuinely cannot invoke it directly — the filter MUST run inside
--      a public, service-role-only function. This closes the out-of-band
--      notification leak that RLS alone cannot police (RLS stops a blocked pair
--      reading each other's content, but a push is a separate channel).
--   3. reply_notification_log — the claim-first idempotency ledger keyed on the
--      reply's own post_id (mirrors moderation_notification_log). Service-role
--      only: RLS enabled with no policies + grants stripped.
--   4. notify_reply_trigger() + its trigger — an AFTER INSERT trigger on
--      collective_posts WHERE parent_post_id IS NOT NULL. It copies the
--      moderation-notification trigger's structure verbatim: pg_net-installed
--      guard, Vault→GUC secret resolution, both-present guard, and the
--      best-effort net.http_post wrapped in EXCEPTION WHEN OTHERS.
--
-- NON-BLOCKING GUARANTEE (load-bearing). The enclosing transaction of the
-- AFTER INSERT trigger is the USER'S OWN REPLY INSERT. An uncaught error in the
-- trigger would abort and roll the user's reply back. So the trigger is
-- deliberately best-effort and MUST NOT raise — a half-configured secret or an
-- absent pg_net silently skips the dispatch, never aborts the reply.

-- ==========================================================================
-- 1. thread_root_user_id — upward walk to the root author.
-- ==========================================================================
-- Walks UP parent_post_id from the given post until a root (parent_post_id
-- NULL) is reached, and returns that root post's user_id. NULL-safe:
--   - a nonexistent post_id anchors zero rows → NULL;
--   - an anonymized root (user_id already SET NULL) → NULL;
--   - a parent cycle never reaches a NULL-parent root, so the CYCLE-guarded
--     walk selects no root row → NULL (never an arbitrary cycle member's
--     author, never a hang, never a raise).
-- Passing a post that is itself a root returns that post's own user_id.
--
-- SECURITY DEFINER + REVOKE-PUBLIC: this reads collective_posts (RLS-gated with
-- no SELECT policy), so it must run as owner; it is granted to service_role
-- only (the Edge Function calls it as client.rpc('thread_root_user_id', ...)).
CREATE OR REPLACE FUNCTION thread_root_user_id(post_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT cp.id, cp.user_id, cp.parent_post_id
    FROM collective_posts cp
    WHERE cp.id = post_id
    UNION ALL
    SELECT parent.id, parent.user_id, parent.parent_post_id
    FROM ancestors a
    JOIN collective_posts parent ON parent.id = a.parent_post_id
  ) CYCLE id SET is_cycle USING path
  SELECT a.user_id
  FROM ancestors a
  WHERE a.parent_post_id IS NULL
    AND NOT a.is_cycle
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION thread_root_user_id(UUID) FROM PUBLIC, authenticated;
GRANT  EXECUTE ON FUNCTION thread_root_user_id(UUID) TO service_role;

-- ==========================================================================
-- 2. notify_reply_eligible_recipients — block filter + preference gate.
-- ==========================================================================
-- Returns each candidate for which BOTH hold:
--   (a) NOT private.is_blocked_either_way(candidate, replier) — reusing the
--       symmetric block predicate (never re-inlining its anti-join), so a
--       block in EITHER direction drops the candidate; and
--   (b) preferences #>> '{reminders,replies,enabled}' = 'true' — the strict
--       reply-notification gate (a missing or false flag excludes the
--       candidate, matching the streak.enabled gate idiom).
-- The block/preference state is read LIVE at execution time, so a block created
-- between the reply INSERT and this async run is honored (TOCTOU resolves in
-- the safe drop direction).
--
-- SECURITY DEFINER + REVOKE-PUBLIC: it reaches into the `private` schema and
-- reads users.preferences for arbitrary users, so it runs as owner and is
-- granted to service_role only. This is the ONLY recipient source the Edge
-- Function trusts — there is deliberately no fan-out path that skips it.
CREATE OR REPLACE FUNCTION notify_reply_eligible_recipients(
  candidate_ids UUID[],
  replier_id    UUID
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  SELECT c.candidate
  FROM unnest(candidate_ids) AS c(candidate)
  WHERE NOT private.is_blocked_either_way(c.candidate, replier_id)
    AND (
      SELECT u.preferences #>> '{reminders,replies,enabled}'
      FROM users u
      WHERE u.id = c.candidate
    ) = 'true';
$$;

REVOKE EXECUTE ON FUNCTION notify_reply_eligible_recipients(UUID[], UUID) FROM PUBLIC, authenticated;
GRANT  EXECUTE ON FUNCTION notify_reply_eligible_recipients(UUID[], UUID) TO service_role;

-- ==========================================================================
-- 3. reply_notification_log — claim-first idempotency ledger.
-- ==========================================================================
-- Keyed on the reply's own post_id. The Edge Function's FIRST DB write is an
-- INSERT ... ON CONFLICT (reply_post_id) DO NOTHING; a zero-row claim means
-- "already processed" → immediate no-op. At-most-once: the claim precedes the
-- Expo POST and is never rolled back, so a delivery failure drops one push
-- rather than risking a duplicate under a trigger double-fire / manual
-- re-invoke. Two concurrent fires serialize on the PK's row lock.
--
-- SERVICE-ROLE-INTERNAL ONLY (mirrors moderation_notification_log): RLS enabled
-- with NO policies, and anon/authenticated stripped of every grant. Only the
-- service role (via the trigger-invoked Edge Function) reads or writes it.
CREATE TABLE reply_notification_log (
  -- PK doubles as the dedupe key. FK ON DELETE CASCADE: this is housekeeping,
  -- so it may go when the referenced reply row is hard-deleted.
  reply_post_id UUID        PRIMARY KEY
                REFERENCES collective_posts(id) ON DELETE CASCADE,
  notified_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS with deliberately NO policies — every client role is denied at the
-- RLS layer, and additionally at the GRANT layer below.
ALTER TABLE reply_notification_log ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip default CRUD grants so anon/authenticated cannot
-- read or write the ledger even if RLS were ever toggled off. The service role
-- retains its grant (table owner / BYPASSRLS) and is the only writer.
REVOKE ALL ON TABLE reply_notification_log FROM anon, authenticated;

-- ==========================================================================
-- 4. notify_reply_trigger — best-effort, non-blocking pg_net dispatch.
-- ==========================================================================
-- Structure copied verbatim from the moderation-notification trigger: the
-- pg_net-installed guard, Vault-first / GUC-fallback secret resolution for
-- edge_base_url + service_role_key, the both-present guard, and the
-- best-effort net.http_post wrapped in EXCEPTION WHEN OTHERS THEN RAISE LOG.
-- The reused secrets are the same edge_base_url / service_role_key as the other
-- trigger-driven functions (no new secret) — see docs/edge-functions-setup.md.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION notify_reply_trigger()
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
  -- Guard 1: pg_net must be installed. Absent => skip cleanly so the user's
  -- reply INSERT still commits.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN NULL;
  END IF;

  -- Resolve the base URL. Vault first (the key never sits in pg_settings), GUC
  -- fallback. The Vault lookup is wrapped so an absent vault schema/table
  -- yields NULL rather than erroring.
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

  -- Guard 2: BOTH must be present + non-empty. A half-configured env (URL set,
  -- key NULL) must not fire an unauthenticated request the function 401s — a
  -- silent, unobservable drop. Belt-and-suspenders with guard 1.
  IF v_base_url IS NULL OR v_base_url = '' OR v_key IS NULL OR v_key = '' THEN
    RETURN NULL;
  END IF;

  v_url := rtrim(v_base_url, '/') || '/functions/v1/notify_reply';

  -- Payload built from NEW — only ids and timestamps, never body text.
  v_payload := jsonb_build_object(
    'id',             NEW.id,
    'user_id',        NEW.user_id,
    'parent_post_id', NEW.parent_post_id,
    'created_at',     NEW.created_at
  );

  -- Best-effort: pg_net enqueues the request and returns immediately (a
  -- background worker performs the HTTP), so this is non-blocking on the
  -- network. Any error here is swallowed so the reply INSERT always commits.
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
    RAISE LOG 'notify_reply_trigger: net.http_post failed (best-effort, swallowed): %', SQLERRM;
  END;

  RETURN NULL;
END;
$$;

-- Trigger functions are invoked by the trigger mechanism, not via EXECUTE, so
-- revoking EXECUTE from PUBLIC does not affect firing — it just prevents direct
-- ad-hoc calls of a SECURITY DEFINER function.
REVOKE EXECUTE ON FUNCTION notify_reply_trigger() FROM PUBLIC;

-- Only replies fire the trigger — the WHEN clause means a top-level post
-- (parent_post_id IS NULL) never enqueues a notification.
CREATE TRIGGER notify_reply_after_insert
  AFTER INSERT ON collective_posts
  FOR EACH ROW
  WHEN (NEW.parent_post_id IS NOT NULL)
  EXECUTE FUNCTION notify_reply_trigger();
