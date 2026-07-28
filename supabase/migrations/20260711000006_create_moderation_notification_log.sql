-- Migration: moderation_notification_log — the idempotency ledger for the
-- async moderation-notification pipeline.
--
-- WHY A SIDE LEDGER. moderation_actions (20260711000000) is permanently
-- append-only/immutable: it has no UPDATE policy and nothing may stamp an
-- audit row after the fact. So "has this action already been notified?" cannot
-- be recorded on the audit row itself. This minimal side table records, keyed
-- on moderation_actions.id, that the notification pipeline has CLAIMED an
-- action. The trigger-invoked Edge Function's first DB write is
--   INSERT ... ON CONFLICT (moderation_action_id) DO NOTHING
-- and it treats "zero rows inserted" as "already processed" — an idempotent
-- no-op that guards against duplicate/retried trigger fires.
--
-- SERVICE-ROLE-INTERNAL ONLY. RLS is enabled with NO client-facing policies,
-- and anon/authenticated are stripped of every grant. The only reader/writer
-- is the service role (via the trigger-invoked Edge Function), which bypasses
-- RLS. No client ever selects from or writes to this table, so it needs no
-- client type/RPC surface.
--
-- FORWARD COMPATIBILITY. A later push-delivery milestone grows this into a
-- per-token delivery/receipt record (e.g. a status/delivered_at column, or a
-- pending-row-then-stamp-on-success two-state model) so a crash-before-delivery
-- becomes retryable rather than silently dropped. At THIS milestone delivery is
-- a stubbed log line (no external side-effect), so a bare row = "claimed" is
-- sufficient (at-most-once semantics).

CREATE TABLE moderation_notification_log (
  -- PK doubles as the dedupe key. FK ON DELETE CASCADE: this is audit-adjacent
  -- housekeeping, not the audit trail itself, so it may go when the referenced
  -- action row is hard-deleted (distinct from moderation_actions' own
  -- actor/target ON DELETE SET NULL anonymization posture).
  moderation_action_id UUID        PRIMARY KEY
                        REFERENCES moderation_actions(id) ON DELETE CASCADE,
  notified_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS. There are deliberately NO policies — every client role is denied
-- at the RLS layer, and additionally at the GRANT layer below.
ALTER TABLE moderation_notification_log ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: strip Supabase's default CRUD grants so anon and
-- authenticated cannot read or write the ledger even if RLS were ever toggled
-- off. The service role retains its grant (table owner / BYPASSRLS) and is the
-- only writer. Direct anon/authenticated access fails with
-- insufficient_privilege (42501).
REVOKE ALL ON TABLE moderation_notification_log FROM anon, authenticated;
