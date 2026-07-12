-- t45: streak-reminder candidate selection, the streak-length copy-tone
-- signal, and the send-ledger's dedupe + access-control posture.
--
-- Coverage:
--   * streak_reminder_candidates(window_minutes DEFAULT 15) selects an
--     enabled + in-window + sub-500-today user, and excludes each of:
--     disabled (enabled=false), no reminders.streak object at all,
--     out-of-window, already-completed-today.
--   * the offset contract: last_local_offset_minutes-absent falls back to an
--     offset derived from users.timezone (a stable, non-DST zone); an unset
--     local_time defaults to '20:00'; a user whose offset EXCEEDS their
--     local send-time minutes is still selected in-window -- the double-mod
--     regression guard (Postgres mod() keeps the dividend's sign, so a bare
--     single mod would compute a permanently-negative, never-due target for
--     this shape of input).
--   * streak_reminder_candidates carries the correct reminder_streak_len.
--   * streak_reminder_length: a consecutive run stops at a gap, excludes a
--     soft-deleted flow from the qualifying-day sum, and is independent of a
--     spent grace day (a grace-covered miss does not bridge the run).
--   * streak_reminder_log: the (user_id, local_send_date) primary key
--     dedupes a double-claim to exactly one row.
--   * authenticated/anon cannot EXECUTE either RPC, and cannot SELECT the
--     ledger table (SQLSTATE 42501) -- service-role only.
--
-- Timing note: pgTAP wraps this whole file in one BEGIN...ROLLBACK
-- transaction, and Postgres's NOW() returns the transaction's start instant
-- for the transaction's ENTIRE duration (not the wall clock at each
-- statement). This file reads "the current UTC minute" exactly once, up
-- front, and every due / not-due fixture below is constructed algebraically
-- from that single frozen instant -- so the suite is fully deterministic
-- regardless of the wall-clock time it happens to run at, with no dependency
-- on a mockable clock inside the RPC itself.
--
-- Red phase: none of streak_reminder_candidates / streak_reminder_length /
-- streak_reminder_log exist yet, so the first reference below raises
-- "does not exist" (or "function ... does not exist") and the whole file
-- aborts before a single TAP line is emitted -- an unambiguous whole-suite
-- failure (mirrors t39's red-phase abort for moderation_notification_log)
-- until the migration lands.

BEGIN;
\i _helpers.psql
SELECT plan(17);

-- Small test-only arithmetic helpers (excluded from the t11 SECURITY DEFINER
-- sweep by the `test_%` name prefix; these are plain, non-DEFINER SQL
-- functions and never reach production). Kept local to this file rather than
-- growing _helpers.psql for a single test's algebra.
CREATE OR REPLACE FUNCTION test_offset_for_due_target(p_local_minutes INT, p_target_minutes INT)
RETURNS INT
LANGUAGE sql
AS $$
  -- Solves for the last_local_offset_minutes that makes the candidate RPC's
  -- double-mod window formula land exactly on p_target_minutes, given a
  -- fixed p_local_minutes: utc_target = mod(mod(local-offset,1440)+1440,1440).
  -- Substituting offset = local + 1440 - target collapses that formula to
  -- exactly `target` for any local/target pair (verified algebraically), and
  -- because 1440 - target_minutes is always > 0 for target_minutes in
  -- [0,1440), the resulting offset is ALWAYS strictly greater than
  -- p_local_minutes -- precisely the "offset exceeds localMinutes" shape a
  -- bare (non-double) mod computes as a permanently-negative utc_target.
  -- That makes this one helper double as a wall-clock-independent fixture
  -- generator for both ordinary due/not-due cases AND the UTC+ regression
  -- guard (test 9 below).
  SELECT p_local_minutes + 1440 - p_target_minutes;
$$;

CREATE OR REPLACE FUNCTION test_fmt_hhmm(p_minutes INT)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT lpad((p_minutes / 60)::text, 2, '0') || ':' || lpad((p_minutes % 60)::text, 2, '0');
$$;

DO $$
DECLARE
  v_utc_now_minute INT;
  v_user           UUID;
  v_flow           UUID;
  v_len            INT;
  v_target         INT;
  v_local_minutes  INT;
  v_offset         INT;
  v_count          INT;
  v_denied         BOOLEAN;
  v_state          TEXT;
BEGIN
  v_utc_now_minute := (
    EXTRACT(HOUR FROM NOW() AT TIME ZONE 'UTC') * 60
    + EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'UTC')
  )::int;

  -- ── (1) Positive: enabled + in-window (due now) + sub-500-today ─────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  -- Also feeds assertion (2): a 2-day consecutive prior run.
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 1, 500);
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 2, 500);
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 3, 50);
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'local_time', test_fmt_hhmm(v_utc_now_minute),
      'last_local_offset_minutes', 0
    ))
  ) WHERE id = v_user;

  PERFORM tap_ok(
    EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'an enabled, in-window, sub-500-today user is selected as a due candidate'
  );

  -- ── (2) reminder_streak_len carried on the candidate row ────────────────
  SELECT c.reminder_streak_len INTO v_len
  FROM streak_reminder_candidates() c
  WHERE c.user_id = v_user;
  PERFORM tap_ok(
    v_len = 2 AND v_len = streak_reminder_length(v_user),
    format('candidate row carries the correct reminder_streak_len (expected 2, got %s)', v_len)
  );

  -- ── (3) disabled (enabled=false) excluded ────────────────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', false,
      'local_time', test_fmt_hhmm(v_utc_now_minute),
      'last_local_offset_minutes', 0
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    NOT EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'a disabled (enabled=false) user is excluded even when otherwise in-window and sub-500'
  );

  -- ── (4) no reminders.streak object at all excluded ──────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  -- preferences stays '{}' from test_seed_user -- no reminders.streak object.
  PERFORM tap_ok(
    NOT EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'a user with no reminders.streak preference object at all is excluded (strict gate)'
  );

  -- ── (5) out-of-window excluded ───────────────────────────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  v_local_minutes := 600; -- 10:00, arbitrary
  v_target := mod(v_utc_now_minute + 200, 1440); -- 200 minutes away: well outside any 15-min window
  v_offset := test_offset_for_due_target(v_local_minutes, v_target);
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'local_time', test_fmt_hhmm(v_local_minutes),
      'last_local_offset_minutes', v_offset
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    NOT EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'a user whose configured send-time is 200 minutes away from now is excluded (out of window)'
  );

  -- ── (6) already-completed-today excluded ────────────────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_500_today(v_user); -- already met today's 500 words
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'local_time', test_fmt_hhmm(v_utc_now_minute),
      'last_local_offset_minutes', 0
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    NOT EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'a user who already completed today''s 500 words is excluded even when enabled and in-window'
  );

  -- ── (7) offset-absent -> users.timezone fallback ────────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  -- America/Bogota is UTC-5 year-round (no DST) -- a stable, non-zero offset
  -- that proves the fallback is DERIVED from users.timezone rather than
  -- coincidentally defaulting to a trivial zero offset.
  UPDATE users SET timezone = 'America/Bogota' WHERE id = v_user;
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'local_time', to_char(NOW() AT TIME ZONE 'America/Bogota', 'HH24:MI')
      -- last_local_offset_minutes intentionally absent (NULL).
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'when last_local_offset_minutes is absent, the offset derived from users.timezone selects the user correctly'
  );

  -- ── (8) unset local_time defaults to '20:00' ────────────────────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  v_local_minutes := 1200; -- 20:00
  v_offset := test_offset_for_due_target(v_local_minutes, v_utc_now_minute);
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'last_local_offset_minutes', v_offset
      -- local_time intentionally omitted -- must default to '20:00'.
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'an unset local_time defaults to 20:00 and selects the user when that default is in-window'
  );

  -- ── (9) UTC+ regression guard: offset exceeds localMinutes ──────────────
  v_user := test_seed_user();
  PERFORM test_seed_sub500_today(v_user);
  v_local_minutes := 300; -- 05:00, mirrors the documented UTC+8 example
  v_offset := test_offset_for_due_target(v_local_minutes, v_utc_now_minute);
  -- v_offset is guaranteed > v_local_minutes by test_offset_for_due_target's
  -- construction -- exactly the shape a bare (non-double) mod would compute
  -- as a permanently-negative, never-due utc_target.
  UPDATE users SET preferences = jsonb_build_object(
    'reminders', jsonb_build_object('streak', jsonb_build_object(
      'enabled', true,
      'local_time', test_fmt_hhmm(v_local_minutes),
      'last_local_offset_minutes', v_offset
    ))
  ) WHERE id = v_user;
  PERFORM tap_ok(
    EXISTS(SELECT 1 FROM streak_reminder_candidates() WHERE user_id = v_user),
    'a user whose offset exceeds their local send-time minutes is still selected in-window (double-mod regression guard)'
  );

  -- ── streak_reminder_length ───────────────────────────────────────────────

  -- (10) a 3-day consecutive run stops at the day-4 gap.
  v_user := test_seed_user();
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 1, 500);
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 2, 700);
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 3, 500);
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 4, 100); -- gap
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 5, 500); -- must not count past the gap
  PERFORM tap_ok(
    streak_reminder_length(v_user) = 3,
    format(
      'streak_reminder_length counts a 3-day consecutive run ending yesterday and stops at the day-4 gap (got %s)',
      streak_reminder_length(v_user)
    )
  );

  -- (11) a soft-deleted flow is excluded from the qualifying-day sum.
  v_user := test_seed_user();
  v_flow := test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 1, 500);
  UPDATE flows SET is_deleted = TRUE WHERE id = v_flow;
  PERFORM tap_ok(
    streak_reminder_length(v_user) = 0,
    'streak_reminder_length excludes a soft-deleted flow from the qualifying-day sum'
  );

  -- (12) grace-independent: a spent grace day on a missed date does not
  -- bridge the gap (this signal is deliberately simpler than the
  -- user-facing, grace-inclusive streak).
  v_user := test_seed_user();
  -- Yesterday is a MISS (sub-500) but has a spent grace day recorded for it.
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 1, 50);
  INSERT INTO user_grace_days (id, user_id, earned_for_milestone, used_for_date)
  VALUES (
    gen_random_uuid(), v_user, 7,
    to_char((NOW() AT TIME ZONE 'UTC')::date - 1, 'YYYY-MM-DD')
  );
  -- Two days back qualifies, but sits on the far side of the grace-covered miss.
  PERFORM test_seed_words_on_date(v_user, (NOW() AT TIME ZONE 'UTC')::date - 2, 500);
  PERFORM tap_ok(
    streak_reminder_length(v_user) = 0,
    'streak_reminder_length is grace-independent -- a spent grace day on a missed date does not bridge the gap'
  );

  -- ── streak_reminder_log ledger ───────────────────────────────────────────

  -- (13) PK dedupe: claiming the same (user_id, local_send_date) twice
  -- yields exactly one row.
  v_user := test_seed_user();
  INSERT INTO streak_reminder_log (user_id, local_send_date) VALUES (v_user, CURRENT_DATE)
  ON CONFLICT (user_id, local_send_date) DO NOTHING;
  INSERT INTO streak_reminder_log (user_id, local_send_date) VALUES (v_user, CURRENT_DATE)
  ON CONFLICT (user_id, local_send_date) DO NOTHING;
  SELECT COUNT(*) INTO v_count
  FROM streak_reminder_log
  WHERE user_id = v_user AND local_send_date = CURRENT_DATE;
  PERFORM tap_ok(v_count = 1, 'claiming the same (user_id, local_send_date) twice yields exactly one ledger row');

  -- ── access control (service-role only) ──────────────────────────────────

  v_user := test_seed_user();

  -- (14) authenticated cannot EXECUTE streak_reminder_candidates.
  PERFORM test_become(v_user);
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM streak_reminder_candidates();
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE streak_reminder_candidates (service-role only)');

  -- (15) authenticated cannot EXECUTE streak_reminder_length.
  v_denied := FALSE;
  BEGIN
    PERFORM streak_reminder_length(v_user);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot EXECUTE streak_reminder_length (service-role only)');

  -- (16) authenticated cannot SELECT the ledger.
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM streak_reminder_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'authenticated cannot SELECT streak_reminder_log (service-role only, no grants)');

  -- (17) anon cannot SELECT the ledger.
  PERFORM test_become_anon();
  v_denied := FALSE;
  BEGIN
    PERFORM count(*) FROM streak_reminder_log;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF v_state = '42501' THEN v_denied := TRUE; END IF;
  END;
  PERFORM tap_ok(v_denied, 'anon cannot SELECT streak_reminder_log (service-role only, no grants)');
END $$;

SELECT * FROM tap_emit();
SELECT * FROM finish();
ROLLBACK;
