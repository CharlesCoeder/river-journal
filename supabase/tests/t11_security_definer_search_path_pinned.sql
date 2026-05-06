-- t11: Every SECURITY DEFINER function in this story declares a pinned
-- `search_path` via SET clause. Verified by querying pg_proc.proconfig.
--
-- Red phase: FAILS because none of the functions exist yet.

BEGIN;
\i _helpers.psql
SELECT plan(5);

DO $$
DECLARE
  v_fname TEXT;
  v_funcs TEXT[] := ARRAY[
    'daily_500_completed_today',
    'is_active_suspension',
    'delete_my_post',
    'collective_feed_page',
    'collective_thread_page'
  ];
  v_proconfig TEXT[];
  v_has_pin BOOLEAN;
BEGIN
  FOREACH v_fname IN ARRAY v_funcs LOOP
    SELECT proconfig INTO v_proconfig
    FROM pg_proc
    WHERE proname = v_fname AND pronamespace = 'public'::regnamespace
    LIMIT 1;

    v_has_pin := FALSE;
    IF v_proconfig IS NOT NULL THEN
      v_has_pin := EXISTS (
        SELECT 1
        FROM unnest(v_proconfig) AS opt
        WHERE opt LIKE 'search_path=%'
      );
    END IF;

    PERFORM tap_ok(v_has_pin, format('function %s has SET search_path pinned via proconfig', v_fname));
  END LOOP;
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
