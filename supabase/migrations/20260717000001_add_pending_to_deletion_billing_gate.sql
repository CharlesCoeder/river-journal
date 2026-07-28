-- Migration: add 'pending' to the account-deletion un-cancelled-billing gate.
--
-- Forward-only amendment to complete_pending_account_deletions() (shipped in
-- 20260717000000_add_account_deletion.sql — NOT edited). The retry sweep's
-- finalize GATE skips any old-marked user who still has a live Stripe receipt so
-- cascading cannot destroy a receipt while Stripe keeps billing. That gate must
-- track the SAME still-billing definition the Edge Function's Phase-A cancel set
-- uses; the Edge path now also cancels 'pending'/incomplete Stripe subs (a
-- not-yet-collected sub that could activate and bill AFTER the row is hard-
-- deleted — the ghost-billing hole). So the sweep gate must ALSO treat a live
-- 'pending' receipt as blocking: if a mid-saga crash left a pending sub un-
-- cancelled, the sweep must preserve the row + receipt for a later Edge retry
-- rather than hard-delete it and strand an un-cancellable pending sub.
--
-- The ONLY change from 20260717000000 is the gate's status set:
--   status IN ('active','past_due')  ->  status IN ('active','past_due','pending')
-- Everything else (per-row isolation, apple/play never gating, Stripe-only,
-- metadata-only logging, SECURITY DEFINER + pinned search_path, grants) is
-- reproduced verbatim. The daily cron scheduled in 20260717000000 calls this
-- function by name, so no re-scheduling is needed.

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
      -- no way for any retry to cancel afterwards. 'pending'/incomplete is
      -- included: it can still activate + bill, and Phase A now cancels it, so
      -- an un-cancelled pending receipt (a mid-saga crash) must block too.
      -- Preserve the row and skip.
      SELECT EXISTS (
        SELECT 1 FROM subscription_receipts
        WHERE user_id = v_rec.id
          AND provider = 'stripe'
          AND status IN ('active', 'past_due', 'pending')
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

-- Re-issue the service-role-internal grant record (CREATE OR REPLACE preserves
-- the existing ACL; re-issuing keeps it explicit + self-documenting, matching
-- the 20260717000000 posture).
REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM anon;
REVOKE EXECUTE ON FUNCTION complete_pending_account_deletions() FROM authenticated;
GRANT  EXECUTE ON FUNCTION complete_pending_account_deletions() TO service_role;
