-- t11: EVERY SECURITY DEFINER function in the public schema declares a pinned
-- `search_path` via a SET clause (proconfig). Verified by querying pg_proc.
--
-- Strengthened after the 2026-07 audit: the previous version allowlisted only
-- the five Collective-story functions, so two SECURITY DEFINER functions that
-- predate that story — handle_new_user() and cleanup_stale_trusted_browsers()
-- — shipped WITHOUT a pinned search_path and went unnoticed. This version
-- asserts over ALL SECURITY DEFINER functions in `public` (one dynamic
-- assertion), so any future unpinned definer function fails the suite.
--
-- The transaction-local test-harness helpers (test_* / tap_*) from
-- _helpers.psql are excluded: they are scaffolding created only inside the test
-- transaction and never reach production. (tap_ok/tap_emit are intentionally
-- unpinned so their ok() call resolves against whatever schema pgTAP is
-- installed into during the run.)

BEGIN;
\i _helpers.psql
SELECT plan(1);

DO $$
DECLARE
  v_unpinned TEXT[];
BEGIN
  SELECT COALESCE(array_agg(p.proname ORDER BY p.proname), ARRAY[]::TEXT[])
  INTO v_unpinned
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prosecdef                                   -- SECURITY DEFINER only
    AND p.proname NOT LIKE 'test\_%'                  -- exclude test scaffolding
    AND p.proname NOT LIKE 'tap\_%'
    AND NOT COALESCE(
      EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS opt
        WHERE opt LIKE 'search_path=%'
      ),
      FALSE
    );

  PERFORM tap_ok(
    cardinality(v_unpinned) = 0,
    format(
      'all SECURITY DEFINER functions in public pin search_path (unpinned: %s)',
      COALESCE(array_to_string(v_unpinned, ', '), '')
    )
  );
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
