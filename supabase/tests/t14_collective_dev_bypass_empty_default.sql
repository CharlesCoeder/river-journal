-- t13: collective_dev_bypass ships EMPTY — the developer gate bypass must have
-- zero effect on the public. Guards the safety invariant of migration
-- 20260618000000_add_collective_dev_bypass.sql: a sub-500 user is still NOT
-- treated as qualified, the allowlist matches nobody, and NULL never matches.
-- If someone fills the allowlist (or breaks its logic), this test fails.

BEGIN;
\i _helpers.psql
SELECT plan(4);

DO $$
DECLARE
  v_sub500 UUID;
  v_full   UUID;
BEGIN
  -- Sub-500 user: bypass is empty, so still gated out.
  v_sub500 := test_seed_user();
  PERFORM test_seed_sub500_today(v_sub500);
  PERFORM tap_ok(
    collective_dev_bypass(v_sub500) = FALSE,
    'collective_dev_bypass returns FALSE for a non-allowlisted user (empty default)'
  );
  PERFORM tap_ok(
    daily_500_completed_today(v_sub500) = FALSE,
    'sub-500 user is still NOT qualified — bypass does not lower the public gate'
  );

  -- NULL caller must never match the allowlist (unauthenticated guard).
  PERFORM tap_ok(
    collective_dev_bypass(NULL) = FALSE,
    'collective_dev_bypass returns FALSE for NULL uid (unauthenticated never bypasses)'
  );

  -- Sanity: a legitimately-qualified user is still TRUE (body unchanged).
  v_full := test_seed_user();
  PERFORM test_seed_500_today(v_full);
  PERFORM tap_ok(
    daily_500_completed_today(v_full) = TRUE,
    'a user who wrote 500 words today is still qualified (predicate body intact)'
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
