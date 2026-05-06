-- t07: Unauthenticated session calling collective_feed_page must raise
-- 'authentication required' with ERRCODE = '42501'. This is the regression
-- for the silent-preview-leak failure mode (auth.uid() IS NULL falling
-- through to the preview branch).
--
-- Red phase: FAILS because collective_feed_page does not exist yet.

BEGIN;
\i _helpers.sql
SELECT plan(1);

DO $$
DECLARE
  v_state TEXT;
  v_denied BOOLEAN := FALSE;
BEGIN
  PERFORM test_become_anon();

  BEGIN
    PERFORM * FROM collective_feed_page(NULL, 20);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;

  PERFORM tap_ok(v_denied, 'unauthenticated collective_feed_page must raise SQLSTATE 42501');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
