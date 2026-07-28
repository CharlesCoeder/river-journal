-- t48: subscription_receipts structural shape + server-write-only,
-- own-or-admin-read RLS.
--
-- Coverage:
--   * column shape (id/user_id/provider/provider_subscription_id/status/
--     current_period_end/last_validated_at/raw_receipt/created_at/updated_at)
--   * PRIMARY KEY on id
--   * user_id FK is ON DELETE CASCADE against users(id)
--   * named UNIQUE (provider, provider_subscription_id) constraint exists
--   * the (user_id, status) entitlement-lookup index exists
--   * RLS is enabled
--   * provider / status CHECK vocabularies reject out-of-set values
--   * empty-string provider_subscription_id is rejected (non-empty CHECK)
--   * duplicate (provider, provider_subscription_id) raises unique_violation
--   * own-read allowed, other-user-read denied (0 rows), admin-read allowed
--   * anon SELECT denied
--   * direct client INSERT / UPDATE / DELETE (as `authenticated`, including
--     the row owner) are ALL denied with SQLSTATE 42501 — there is no write
--     policy at all; writes flow exclusively through the service-role
--     Edge Functions that validate and upsert receipts.
--
-- Red phase: the table does not exist yet, so every DML statement below
-- raises "relation ... does not exist" and the whole file aborts with no
-- TAP output — an unambiguous suite failure until the migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(17);

DO $$
DECLARE
  v_mismatched         TEXT[];
  v_pk_count           INT;
  v_fk_deltype         TEXT;
  v_unique_name        TEXT;
  v_unique_cols        TEXT[];
  v_idx_count          INT;
  v_rls_enabled        BOOLEAN;
  v_owner              UUID;
  v_other              UUID;
  v_admin_actor        UUID;
  v_receipt_id         UUID := gen_random_uuid();
  v_provider_rejected  BOOLEAN := FALSE;
  v_status_rejected    BOOLEAN := FALSE;
  v_empty_rejected     BOOLEAN := FALSE;
  v_dup_rejected       BOOLEAN := FALSE;
  v_own_visible        INT;
  v_other_visible      INT;
  v_admin_visible      INT;
  v_state              TEXT;
  v_anon_denied        BOOLEAN := FALSE;
  v_insert_denied      BOOLEAN := FALSE;
  v_update_denied      BOOLEAN := FALSE;
  v_delete_denied      BOOLEAN := FALSE;
BEGIN
  -- (1) column shape: name/type/nullability for every declared column.
  SELECT COALESCE(array_agg(expected.col ORDER BY expected.col), ARRAY[]::TEXT[])
  INTO v_mismatched
  FROM (VALUES
    ('id',                       'uuid',                     'NO'),
    ('user_id',                  'uuid',                     'NO'),
    ('provider',                 'text',                     'NO'),
    ('provider_subscription_id', 'text',                     'NO'),
    ('status',                   'text',                     'NO'),
    ('current_period_end',       'timestamp with time zone', 'NO'),
    ('last_validated_at',        'timestamp with time zone', 'NO'),
    ('raw_receipt',              'jsonb',                    'YES'),
    ('created_at',               'timestamp with time zone', 'NO'),
    ('updated_at',               'timestamp with time zone', 'NO')
  ) AS expected(col, data_type, is_nullable)
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'subscription_receipts'
    AND c.column_name = expected.col
    AND c.data_type = expected.data_type
    AND c.is_nullable = expected.is_nullable
  WHERE c.column_name IS NULL;

  PERFORM tap_ok(
    cardinality(v_mismatched) = 0,
    format('subscription_receipts columns match the expected shape (mismatched: %s)', COALESCE(array_to_string(v_mismatched, ', '), ''))
  );

  -- (2) primary key on id.
  SELECT COUNT(*) INTO v_pk_count
  FROM pg_constraint
  WHERE conrelid = 'public.subscription_receipts'::regclass
    AND contype = 'p';
  PERFORM tap_ok(v_pk_count = 1, 'subscription_receipts has a primary key');

  -- (3) user_id FK is ON DELETE CASCADE against users(id).
  SELECT con.confdeltype INTO v_fk_deltype
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.subscription_receipts'::regclass
    AND con.contype = 'f'
    AND att.attname = 'user_id'
  LIMIT 1;
  PERFORM tap_ok(v_fk_deltype = 'c', 'subscription_receipts.user_id FK is ON DELETE CASCADE');

  -- (4) named UNIQUE (provider, provider_subscription_id) constraint exists.
  SELECT con.conname INTO v_unique_name
  FROM pg_constraint con
  WHERE con.conrelid = 'public.subscription_receipts'::regclass
    AND con.contype = 'u'
    AND con.conname = 'subscription_receipts_provider_provider_subscription_id_key';

  SELECT COALESCE(array_agg(att.attname ORDER BY att.attname), ARRAY[]::TEXT[])
  INTO v_unique_cols
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'public.subscription_receipts'::regclass
    AND con.conname = 'subscription_receipts_provider_provider_subscription_id_key';

  PERFORM tap_ok(
    v_unique_name IS NOT NULL
      AND v_unique_cols = ARRAY['provider', 'provider_subscription_id'],
    format('named UNIQUE subscription_receipts_provider_provider_subscription_id_key on (provider, provider_subscription_id) exists (found cols: %s)', COALESCE(array_to_string(v_unique_cols, ', '), ''))
  );

  -- (5) the (user_id, status) entitlement-lookup index exists.
  SELECT COUNT(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'subscription_receipts'
    AND indexname = 'subscription_receipts_user_id_status_idx';
  PERFORM tap_ok(v_idx_count = 1, 'index subscription_receipts_user_id_status_idx on (user_id, status) exists');

  -- (6) RLS enabled.
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_class
  WHERE oid = 'public.subscription_receipts'::regclass;
  PERFORM tap_ok(COALESCE(v_rls_enabled, FALSE), 'row level security is enabled on subscription_receipts');

  -- Fixtures for the behavioral assertions below.
  v_owner       := test_seed_user();
  v_other       := test_seed_user();
  v_admin_actor := test_seed_user();

  -- (7) provider CHECK rejects any value outside ('stripe','apple_iap','play_iap'),
  -- seeded directly as table owner so this isolates the constraint from RLS.
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_owner, 'paypal', 'sub_bad_provider', 'active', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN check_violation THEN v_provider_rejected := TRUE;
  END;
  PERFORM tap_ok(v_provider_rejected, 'a provider value outside (stripe, apple_iap, play_iap) is rejected by CHECK');

  -- (8) status CHECK rejects any value outside the declared vocabulary.
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_owner, 'stripe', 'sub_bad_status', 'lapsed', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN check_violation THEN v_status_rejected := TRUE;
  END;
  PERFORM tap_ok(v_status_rejected, 'a status value outside the declared vocabulary is rejected by CHECK');

  -- (9) empty-string provider_subscription_id is rejected (non-empty CHECK) —
  -- NOT NULL alone would admit '', silently colliding under the UNIQUE
  -- constraint and matching nothing at read time.
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_owner, 'stripe', '', 'active', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN check_violation THEN v_empty_rejected := TRUE;
  END;
  PERFORM tap_ok(v_empty_rejected, 'an empty-string provider_subscription_id is rejected by CHECK');

  -- Seed one valid receipt for the own-read / admin-read / other-read /
  -- UNIQUE-violation assertions below.
  INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
  VALUES (v_receipt_id, v_owner, 'stripe', 'sub_valid_001', 'active', NOW() + INTERVAL '30 days');

  -- (10) duplicate (provider, provider_subscription_id) raises unique_violation
  -- — this is the exact conflict target the receipt upsert relies on.
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_other, 'stripe', 'sub_valid_001', 'pending', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN unique_violation THEN v_dup_rejected := TRUE;
  END;
  PERFORM tap_ok(v_dup_rejected, 'a duplicate (provider, provider_subscription_id) pair raises unique_violation');

  -- (11) the owner can SELECT their own receipt row.
  PERFORM test_become(v_owner);
  SELECT COUNT(*) INTO v_own_visible FROM subscription_receipts WHERE id = v_receipt_id;
  PERFORM tap_ok(v_own_visible = 1, 'the owner can SELECT their own subscription_receipts row');

  -- (12) a different, non-admin authenticated user sees zero rows.
  PERFORM test_become(v_other);
  SELECT COUNT(*) INTO v_other_visible FROM subscription_receipts WHERE id = v_receipt_id;
  PERFORM tap_ok(v_other_visible = 0, 'a different non-admin user cannot SELECT another user''s subscription_receipts row');

  -- (13) an admin (is_admin JWT claim) can SELECT any user's receipt row —
  -- proves the admin OR-branch of the select policy.
  PERFORM test_become_admin(v_admin_actor);
  SELECT COUNT(*) INTO v_admin_visible FROM subscription_receipts WHERE id = v_receipt_id;
  PERFORM tap_ok(v_admin_visible = 1, 'an admin can SELECT any user''s subscription_receipts row');

  -- (14) anon has no grant on the table at all.
  PERFORM test_become_anon();
  BEGIN
    PERFORM COUNT(*) FROM subscription_receipts;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_anon_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_anon_denied, 'anon has no SELECT grant on subscription_receipts');

  -- (15) direct client INSERT — even by the eventual row owner — is denied.
  -- There is NO INSERT policy and the REVOKE ALL / GRANT SELECT hardening
  -- strips the write grant outright.
  PERFORM test_become(v_owner);
  BEGIN
    INSERT INTO subscription_receipts (id, user_id, provider, provider_subscription_id, status, current_period_end)
    VALUES (gen_random_uuid(), v_owner, 'apple_iap', 'sub_client_forged', 'active', NOW() + INTERVAL '30 days');
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_insert_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_insert_denied, 'a direct client INSERT into subscription_receipts (even by the row owner) is denied with 42501');

  -- (16) direct client UPDATE — even of the caller's own row — is denied.
  -- Only the service-role Edge Functions (7.2/7.3) may write.
  BEGIN
    UPDATE subscription_receipts SET status = 'canceled' WHERE id = v_receipt_id;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_update_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_update_denied, 'a direct client UPDATE of subscription_receipts (even of the owner''s own row) is denied with 42501');

  -- (17) direct client DELETE — even of the caller's own row — is denied.
  BEGIN
    DELETE FROM subscription_receipts WHERE id = v_receipt_id;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      IF v_state = '42501' THEN v_delete_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_delete_denied, 'a direct client DELETE of subscription_receipts (even of the owner''s own row) is denied with 42501');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
