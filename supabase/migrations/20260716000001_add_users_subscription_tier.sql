-- Migration: add the users.subscription_tier native enum column — the sole
-- field the UI reads to gate paid features.
--
-- This is the enum the streak state layer forward-referenced (see the note in
-- packages/app/state/streak.ts about the subscription_tier enum shipping
-- later). It resolves that placeholder.
--
-- WRITE-PATH INVARIANT — READ THIS BEFORE EDITING.
-- subscription_tier is SERVER-WRITTEN-ONLY. The only intended writer is the
-- receipt-validation Edge Function (service-role) plus the Stripe
-- subscription-deletion webhook. The client NEVER writes it directly.
--
-- Entitlement gating reads this column, so a client must never be able to
-- self-promote its tier. The existing users_update_own policy is
-- FOR UPDATE USING (id = auth.uid()) with no WITH CHECK and no column scope, so
-- without further hardening an authenticated client could
-- `UPDATE users SET subscription_tier = 'paid_yearly' WHERE id = auth.uid()`
-- and self-grant paid entitlements. We close this at the PRIVILEGE layer (NOT a
-- trigger, NOT a policy edit) so a direct client UPDATE of this column fails
-- with insufficient_privilege (SQLSTATE 42501), while the service-role writer,
-- the users_update_own policy, and every other user-writable column all keep
-- working unchanged.
--
-- MECHANISM — why a bare column REVOKE is not enough. Supabase grants
-- authenticated/anon a TABLE-level UPDATE on public.users, which authorizes
-- every column regardless of any column-level grant record. In PostgreSQL a
-- column-scoped `REVOKE UPDATE (col)` is therefore a no-op while the table-wide
-- grant stands — the client keeps write access to the column. The only way to
-- deny one column while leaving the rest writable is to REVOKE the table-level
-- UPDATE and re-GRANT UPDATE on every column EXCEPT subscription_tier. That is
-- exactly what we do below (an explicit column allow-list). service_role is not
-- touched, so the Edge Function writer keeps full UPDATE.
--
-- No `users` RLS *policy* change is needed or added. The existing owner-scoped
-- policies from 20260221000000_create_users.sql already cover the new column
-- for reads and legitimate row-scoped writes (RLS is row-scoped; a new column
-- is within-row). The fix here is a column GRANT allow-list, deliberately NOT a
-- policy or trigger edit.

-- The enum type IS the value-enforcement (a native enum makes an additional
-- CHECK redundant) and types cleanly as
-- Database['public']['Enums']['subscription_tier'], mirroring encryption_mode.
CREATE TYPE public.subscription_tier AS ENUM ('free', 'paid_monthly', 'paid_yearly');

-- New column: existing rows take the default 'free' (no USING cast needed). On
-- PG11+ a constant-default NOT NULL add is metadata-only — no table rewrite.
ALTER TABLE public.users
  ADD COLUMN subscription_tier public.subscription_tier NOT NULL DEFAULT 'free';

-- Close the client-write path at the privilege layer (see MECHANISM in header):
-- strip the table-wide UPDATE that would otherwise authorize every column, then
-- re-grant UPDATE on every column EXCEPT subscription_tier. A direct client
-- UPDATE of subscription_tier then fails with 42501; all other columns stay
-- client-writable and the users_update_own policy is untouched. service_role is
-- deliberately not revoked, so the Edge Function writer keeps full UPDATE.
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
