-- Migration: the server-side account-deletion engine.
--
-- Adds three objects plus one privilege-hardening step:
--   1. users.deletion_requested_at        — the partial-delete state marker.
--   2. delete_my_account(p_user_id uuid)   — the atomic SECURITY DEFINER cascade
--      RPC (soft-anonymize Collective contributions + hard-delete private/
--      operational data), invoked by the Edge Function and the retry sweep.
--   3. complete_pending_account_deletions() — the daily pg_cron retry sweep that
--      finishes any deletion an Edge invocation crashed mid-saga on, and removes
--      the auth identity LAST.
--   4. Column-privilege hardening so deletion_requested_at is server-write-only
--      (excluded from the authenticated INSERT/UPDATE allow-lists, exactly like
--      subscription_tier).
--
-- WHY AN EXPLICIT RPC WHEN THE FK GRAPH ALREADY CASCADES. Every user-referencing
-- FK already does exactly what deletion needs when auth.users is removed:
-- collective_posts/collective_reactions/moderation_actions are ON DELETE SET
-- NULL (anonymized), and the private/operational tables + user_blocks (both
-- directions) + daily_entries (→ flows) are ON DELETE CASCADE (hard-deleted). So
-- deleting auth.users alone would cascade the whole tree. We still write the
-- explicit RPC because: (a) OBSERVABILITY — per-step deletion is testable/
-- loggable; (b) INTENT — soft-anonymize is a deliberate product decision, not an
-- accident of an FK clause, and must be explicit + test-pinned; (c) RESILIENCE —
-- a future migration that flips a SET NULL/CASCADE to RESTRICT/NO ACTION would
-- otherwise make the finalizing auth-delete fail with an opaque FK violation and
-- silently strand every deletion; the explicit child-deletes clear the way. The
-- auth-delete is the finalizer that removes the identity + the (now data-empty)
-- public.users row.
--
-- MARKER IS NEVER TOUCHED FOR auth.users. The RPC deliberately does NOT delete
-- the users row and does NOT touch auth.users — those are the Edge wrapper's
-- final auth-admin call (or the sweep's direct DELETE) so the auth identity is
-- the LAST thing to go and a retry can always locate a stuck user by the
-- surviving users/auth.users rows keyed off deletion_requested_at.

-- ============================================================================
-- 1. Partial-delete state marker.
-- ============================================================================
-- A timestamp (not a boolean) so the sweep can threshold pending deletions by
-- age (a 1-hour grace window before the sweep touches a row, so it never races
-- the synchronous Edge path). Nullable; server-written only.
ALTER TABLE public.users
  ADD COLUMN deletion_requested_at TIMESTAMPTZ NULL;

-- ============================================================================
-- 2. Server-write-only hardening for deletion_requested_at.
-- ============================================================================
-- deletion_requested_at gates the retry sweep, so a client must never be able to
-- write it (dodge the sweep by setting a far-future value) or clear it (hide an
-- in-progress deletion). Close this at the PRIVILEGE layer, the same mechanism
-- subscription_tier uses (20260716000001 / 20260716000003): a table-wide
-- INSERT/UPDATE grant authorizes every column regardless of a column-level
-- REVOKE, so the only way to deny one column is to REVOKE the table-level
-- privilege and re-GRANT it on every column EXCEPT the server-only ones. A newly
-- ADDed column receives no column grant by default, so it is already unwritable
-- by authenticated; re-issuing the exact allow-list here makes that explicit and
-- keeps the grant record self-documenting (subscription_tier AND
-- deletion_requested_at are the two excluded columns). service_role is untouched,
-- so the Edge Function / definer functions keep full write. The dynamic
-- allow-list-completeness regression asserts this exclusion holds.
REVOKE UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (
  id,
  encryption_mode,
  encryption_salt,
  encryption_key_verifier,
  managed_encryption_key,
  preferences,
  age_attested_at,
  timezone,
  created_at,
  updated_at
) ON public.users TO authenticated;

REVOKE INSERT ON public.users FROM anon, authenticated;
GRANT INSERT (
  id,
  encryption_mode,
  encryption_salt,
  encryption_key_verifier,
  managed_encryption_key,
  preferences,
  age_attested_at,
  timezone,
  created_at,
  updated_at
) ON public.users TO authenticated;

-- ============================================================================
-- 3. The atomic cascade RPC.
-- ============================================================================
-- One function-body transaction: soft-anonymize the Collective + moderation-
-- actor references, then hard-delete the private/operational rows. Idempotent —
-- re-running on an already-cascaded user finds nothing and is a harmless no-op
-- (this is the path the sweep-invoked retry relies on). Does NOT delete the
-- users row and does NOT touch auth.users (see header).
--
-- USER-REFERENCING TABLES enumerated as of authoring (the set the t52
-- FK-coverage guard pins — a future ADD of a user-referencing table with an
-- unhandled RESTRICT/NO ACTION FK fails that guard and forces an extension here):
--   SET NULL (anonymized): collective_posts.user_id, collective_reactions.user_id,
--     moderation_actions.actor_user_id + moderation_actions.target_user_id.
--   CASCADE (hard-deleted): collective_reports.reporter_user_id,
--     user_push_tokens.user_id, user_grace_days.user_id, user_suspensions.user_id,
--     subscription_receipts.user_id, trusted_browsers.user_id (→ auth.users),
--     user_blocks.blocker_user_id + user_blocks.blocked_user_id,
--     daily_entries.user_id (→ flows via daily_entry_id), streak_reminder_log.user_id,
--     public.users.id (→ auth.users).
-- The RPC explicitly handles only the rows this product decision cares about;
-- everything else the auth-delete finalizer cascades away.
CREATE OR REPLACE FUNCTION delete_my_account(p_user_id uuid)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- (1) Mark the partial-delete state. Idempotent: only the first pass sets it,
  -- so a re-run keeps the original marker timestamp (the sweep thresholds on it).
  UPDATE users
  SET deletion_requested_at = now()
  WHERE id = p_user_id AND deletion_requested_at IS NULL;

  -- (2) Soft-anonymize moderation actions where the user is the ACTOR (preserve
  -- audit-log integrity — the row + action_type survive; the target field of
  -- rows naming this user as target is deliberately left untouched).
  UPDATE moderation_actions
  SET actor_user_id = NULL
  WHERE actor_user_id = p_user_id;

  -- (3) Soft-anonymize Collective posts (Reddit pattern: bodies retained for
  -- community continuity; applies to self-deleted rows too — nulling user_id
  -- additionally severs the identity link).
  UPDATE collective_posts
  SET user_id = NULL
  WHERE user_id = p_user_id;

  -- (4) Soft-anonymize Collective reactions (counts preserved; the
  -- UNIQUE (post_id, user_id, kind) constraint permits multiple NULL rows since
  -- NULLs are distinct in a Postgres unique index — intentional).
  UPDATE collective_reactions
  SET user_id = NULL
  WHERE user_id = p_user_id;

  -- (5) Hard-delete reports filed BY the user (a private moderation signal, not
  -- a community contribution).
  DELETE FROM collective_reports WHERE reporter_user_id = p_user_id;

  -- (6) Hard-delete the private/operational rows.
  DELETE FROM user_push_tokens WHERE user_id = p_user_id;
  DELETE FROM user_grace_days WHERE user_id = p_user_id;
  DELETE FROM user_suspensions WHERE user_id = p_user_id;
  DELETE FROM subscription_receipts WHERE user_id = p_user_id;
  DELETE FROM trusted_browsers WHERE user_id = p_user_id;

  -- (7) Hard-delete blocks in BOTH directions (the deleting user as blocker OR
  -- as blocked — nothing meaningful is retained post-deletion).
  DELETE FROM user_blocks
  WHERE blocker_user_id = p_user_id OR blocked_user_id = p_user_id;

  -- (8) Hard-delete journal entries (cascades to flows via the existing FK).
  DELETE FROM daily_entries WHERE user_id = p_user_id;
END;
$$;

-- SERVICE-ROLE-INTERNAL ONLY. Supabase grants EXECUTE directly to anon/
-- authenticated on new public functions (not merely via PUBLIC), so revoke all
-- three client-reachable grants — a client role calling this fails with 42501.
-- The Edge Function (service-role) and the sweep are the only callers.
REVOKE EXECUTE ON FUNCTION delete_my_account(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_my_account(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION delete_my_account(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION delete_my_account(uuid) TO service_role;

-- ============================================================================
-- 4. The daily retry sweep + backstop auth-identity removal.
-- ============================================================================
-- Finish any deletion an Edge invocation crashed mid-saga on. Finds every user
-- whose marker is older than the 1-hour grace window (so it never races the
-- synchronous Edge path), re-runs the idempotent cascade, then removes the auth
-- identity via a DIRECT DELETE FROM auth.users (the sweep runs in SQL and cannot
-- call the GoTrue admin API; the direct delete relies on the same FK cascades
-- that remove the now-data-empty public.users row + trusted_browsers). This is
-- the SOLE backstop for auth-identity removal, guaranteeing completion within
-- the 30-day window even if the Edge invocation dies after cancelling billing.
--
-- PER-ROW ISOLATION. Each user's completion runs in its own BEGIN/EXCEPTION
-- block so one failing row (an unexpected FK RESTRICT, a lock) does NOT roll back
-- or abort the whole nightly batch and strand every other pending deletion.
-- Success/failure counts + the failing SQLSTATE (metadata only — never SQLERRM,
-- which could echo a value) are logged; no PII is emitted.
--
-- UN-CANCELLED-BILLING GATE (finalize safety). The synchronous Edge path cancels
-- Stripe subscriptions (Phase A) BEFORE it ever mutates data, and only that path
-- can reach the provider (the sweep runs in SQL and cannot call Stripe). So if a
-- swept user STILL has a live Stripe receipt (status IN ('active','past_due')),
-- Phase A never succeeded for them: cascading now would hard-delete
-- subscription_receipts (and its provider_subscription_id) while Stripe keeps
-- billing — an unrecoverable state where no retry can ever locate the
-- subscription to cancel. The gate therefore SKIPS such a user entirely (no
-- cascade, no auth-delete), leaving the marker AND the receipt intact so a later
-- Edge-Function retry can still cancel with the provider and finish the deletion.
-- Apple/Play receipts do NOT gate: they have no server cancel API and are
-- cancelled natively by the user (the flow accepts a required native action), so
-- they must never block finalization. A blocked user is logged metadata-only
-- (user_id + a counter, no SQLSTATE — this is a deliberate skip, not an error)
-- and counted separately in the batch summary.
CREATE OR REPLACE FUNCTION complete_pending_account_deletions()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rec     RECORD;
  v_success INTEGER := 0;
  v_failure INTEGER := 0;
  v_blocked INTEGER := 0;
  v_has_live_stripe BOOLEAN;
BEGIN
  FOR v_rec IN
    SELECT id
    FROM users
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < now() - INTERVAL '1 hour'
  LOOP
    BEGIN
      -- Finalize GATE: never cascade a user whose Stripe subscription is still
      -- live — that would destroy the receipt while Stripe keeps billing, with
      -- no way for any retry to cancel afterwards. Preserve the row and skip.
      SELECT EXISTS (
        SELECT 1 FROM subscription_receipts
        WHERE user_id = v_rec.id
          AND provider = 'stripe'
          AND status IN ('active', 'past_due')
      ) INTO v_has_live_stripe;

      IF v_has_live_stripe THEN
        v_blocked := v_blocked + 1;
        RAISE LOG 'complete_pending_account_deletions: user_id=% deletion blocked: uncancelled billing receipt (skipped; receipt preserved for provider retry) blocked=%',
          v_rec.id, v_blocked;
        CONTINUE;
      END IF;

      PERFORM delete_my_account(v_rec.id);
      -- Auth identity removed LAST (FK-cascades the data-empty users row).
      DELETE FROM auth.users WHERE id = v_rec.id;
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failure := v_failure + 1;
      RAISE LOG 'complete_pending_account_deletions: user_id=% failed (isolated; batch continues) sqlstate=%',
        v_rec.id, SQLSTATE;
    END;
  END LOOP;

  RAISE LOG 'complete_pending_account_deletions: batch done success=% failure=% blocked=%', v_success, v_failure, v_blocked;
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM anon;
REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM authenticated;
GRANT  EXECUTE ON FUNCTION complete_pending_account_deletions() TO service_role;

-- ============================================================================
-- 5. Schedule the sweep daily.
-- ============================================================================
-- pg_cron is available on hosted Supabase but absent in local dev; skip
-- gracefully so the migration applies cleanly in both places (exact
-- 20260716000003 / 20260713000000 precedent). Pure SQL — no pg_net / Edge
-- dispatch (the sweep is a DB state change + a direct auth.users delete).
--
-- OPS FOLLOW-UP: this sweep is the SOLE backstop for
-- auth-identity removal within the 30-day window. If pg_cron is NOT actually
-- enabled in the deployed environment, the guarded cron.schedule below is a
-- SILENT no-op and the deletion guarantee is silently violated. Post-deploy the
-- runbook must verify a cron.job named 'account-deletion-completion' exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'account-deletion-completion',
      '23 4 * * *',
      'SELECT complete_pending_account_deletions()'
    );
  END IF;
END
$$;
