-- Migration: Create subscription_receipts table — the entitlement substrate
-- for paid-tier subscriptions across all three billing providers.
--
-- SECURITY / DATA MODEL — READ THIS BEFORE EDITING.
-- This table is SERVER-WRITTEN-ONLY. RLS is enabled with:
--   * a SELECT policy that grants read access to the row's own user
--     (auth.uid() = user_id) OR to an admin (JWT claim is_admin = true, for
--     support). A user reads only their own receipts.
--   * NO INSERT / UPDATE / DELETE policy — direct client writes are
--     permanently denied. The ONLY write path is the receipt-validation and
--     cancel Edge Functions, which run with the service-role client (bypasses
--     RLS). The belt-and-suspenders REVOKE below re-grants SELECT only, so any
--     direct client INSERT/UPDATE/DELETE fails with insufficient_privilege
--     (SQLSTATE 42501) even if RLS were ever toggled off.
--
-- Three-provider accommodation invariant: this single shape accommodates all
-- three billing providers with no further schema change. `provider` CHECK
-- admits ('stripe', 'apple_iap', 'play_iap'); `raw_receipt` JSONB holds any
-- provider's receipt payload; `provider_subscription_id` holds any provider's
-- subscription identifier.
--
-- PCI / data-handling invariant: `raw_receipt` may hold provider-issued
-- identifiers and metadata but NEVER card numbers, CVVs, or full PAN data.
-- Provider receipts do not carry these; card data is handled exclusively
-- within the third-party processor's surface and never reaches this app. This
-- is a documented structural invariant, enforced upstream by the payment
-- processors.
--
-- user_id is ON DELETE CASCADE: a receipt is meaningless without its user.
-- Account deletion cancels active subscriptions first (via the cancel Edge
-- Function) and then deletes the user, so cascading the receipt rows away at
-- deletion time is correct. If financial/tax retention of receipt records is
-- later required, that is a forward migration to ON DELETE SET NULL + a
-- nullable user_id — out of scope here.
--
-- Architecture: plaintext, server-visible (opted OUT of the encryption
-- transform); read via TanStack Query in a later milestone, NOT syncedSupabase.

CREATE TABLE subscription_receipts (
  -- Server-generated: rows are written only by the service-role Edge Functions,
  -- so the id is defaulted here rather than client-supplied.
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT        NOT NULL
                           CHECK (provider IN ('stripe', 'apple_iap', 'play_iap')),
  -- NON-EMPTY CHECK: NOT NULL alone would admit '', which would silently
  -- collide under the UNIQUE constraint below and match nothing at read time.
  provider_subscription_id TEXT        NOT NULL CHECK (provider_subscription_id <> ''),
  status                   TEXT        NOT NULL
                           CHECK (status IN ('active', 'pending', 'canceled', 'past_due', 'expired')),
  current_period_end       TIMESTAMPTZ NOT NULL,
  last_validated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_receipt              JSONB       NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Duplicate-receipt guard: one row per provider subscription. This is the
  -- conflict target the validate-receipt Edge Function upserts against with
  -- ON CONFLICT (a provider re-issuing the same subscription id flips the
  -- existing row's status rather than inserting a duplicate).
  CONSTRAINT subscription_receipts_provider_provider_subscription_id_key
    UNIQUE (provider, provider_subscription_id)
);

-- Index backing "does this user have an active receipt" entitlement lookups.
CREATE INDEX subscription_receipts_user_id_status_idx
  ON subscription_receipts (user_id, status);

-- Enable Row Level Security. Reads are own-or-admin (policy below); there is NO
-- INSERT/UPDATE/DELETE policy, so those are denied for every client role.
ALTER TABLE subscription_receipts ENABLE ROW LEVEL SECURITY;

-- SELECT: the row's own user OR an admin (JWT claim). The is_admin claim is
-- minted top-level by the signed access-token hook and is not client-settable;
-- an absent claim yields NULL and falls through to the own-row branch.
CREATE POLICY "subscription_receipts_select_own_or_admin"
  ON subscription_receipts FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR (auth.jwt() ->> 'is_admin')::boolean = true
  );

-- NO INSERT / UPDATE / DELETE policies — deliberate and permanent. Writes flow
-- exclusively through the receipt-validation and cancel Edge Functions running
-- with the service-role client (bypasses RLS). Direct client writes are
-- permanently denied.

-- Belt-and-suspenders grants: strip default CRUD grants and re-grant SELECT
-- only. RLS still narrows SELECT to own-or-admin; the service-role writer is
-- unaffected by this REVOKE (it targets anon/authenticated only). Because
-- authenticated/anon hold no write grant, direct INSERT/UPDATE/DELETE fail
-- with insufficient_privilege (42501). Mirrors moderation_actions hardening.
REVOKE ALL ON TABLE subscription_receipts FROM anon, authenticated;
GRANT SELECT ON TABLE subscription_receipts TO authenticated;

-- Reuse the existing handle_times() function from
-- 20260301000000_add_updated_at_triggers.sql. DO NOT redefine the function here.
CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON subscription_receipts
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();
