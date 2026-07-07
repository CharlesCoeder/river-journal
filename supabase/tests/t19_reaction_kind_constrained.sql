-- t19: collective_reactions.kind is constrained to the fixed client vocabulary
-- ('heart','sparkle','flame','leaf','wave'). An in-set kind inserts; an
-- out-of-set kind is rejected by the CHECK (collective_reactions_kind_chk).

BEGIN;
\i _helpers.psql
SELECT plan(2);

DO $$
DECLARE
  v_uid  UUID;
  v_post UUID := gen_random_uuid();
  v_accepted BOOLEAN := FALSE;
  v_rejected BOOLEAN := FALSE;
BEGIN
  v_uid := test_seed_user();
  PERFORM test_seed_500_today(v_uid);

  PERFORM test_become(v_uid);
  INSERT INTO collective_posts (id, user_id, title, body)
  VALUES (v_post, v_uid, 'Kind title', 'kind body');

  -- Accept: a valid in-set kind.
  BEGIN
    INSERT INTO collective_reactions (id, post_id, user_id, kind)
    VALUES (gen_random_uuid(), v_post, v_uid, 'sparkle');
    v_accepted := TRUE;
  EXCEPTION
    WHEN check_violation THEN v_accepted := FALSE;
  END;

  -- Reject: an out-of-set free-text kind.
  BEGIN
    INSERT INTO collective_reactions (id, post_id, user_id, kind)
    VALUES (gen_random_uuid(), v_post, v_uid, 'thumbsup-xss');
    v_rejected := FALSE;
  EXCEPTION
    WHEN check_violation THEN v_rejected := TRUE;
  END;

  PERFORM tap_ok(v_accepted, 'in-set reaction kind (sparkle) is accepted');
  PERFORM tap_ok(v_rejected, 'out-of-set reaction kind is rejected by CHECK');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
