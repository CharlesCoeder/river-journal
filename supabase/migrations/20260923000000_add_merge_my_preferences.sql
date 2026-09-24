-- Migration: merge_my_preferences — the server half of cross-device
-- preferences sync.
--
-- Until now users.preferences was never written by any client: the app kept
-- every preference on-device only, so the server-side readers (the streak
-- reminder cron, notify_reply_eligible_recipients, the moderation notify gate)
-- only ever saw '{}' and no push category could dispatch. This RPC is the one
-- write path the client uses to publish preference changes.
--
-- WHY AN RPC and not a client read-modify-write UPDATE of the whole column:
-- two devices editing different keys concurrently would clobber each other
-- (last whole-object write wins). The client sends only the leaves it changed;
-- the merge runs inside a single UPDATE, so the row lock serializes concurrent
-- merges and each one applies on top of the latest committed document.
--
-- MERGE SEMANTICS (preferences_deep_merge):
--   * object + object  → recursive merge (sibling keys are preserved);
--   * top-level `unlockedThemes` / `locallyHiddenPosts` arrays → order-
--     preserving union (existing elements first, then new ones). Both are
--     grow-only sets on the client — a spent unlock token or a hidden post is
--     never removed — so a union lets two offline devices both add without
--     losing either addition. The client caps unlocked themes to tokens earned
--     (chosenUnlocks.slice(0, unlockTokensEarned)), so a union can never grant
--     extra themes;
--   * anything else     → the patch value replaces the stored value (last
--     writer wins per leaf). A JSON null is stored as null, not as a delete —
--     no preference is ever removed by sync.
--
-- `feature_flags` is server-seeded and read-only for clients through this path:
-- it is stripped from every patch. (Paid features are gated on
-- users.subscription_tier, never on this flag.)
--
-- An empty patch is a pure read — the client uses it to pull the current
-- document on sign-in and app foreground without writing the row.
--
-- SECURITY INVOKER: the caller's own users_update_own / users_select_own RLS
-- policies and the column-level UPDATE (preferences) grant do the scoping;
-- the function adds no privilege the client does not already hold. It only
-- makes the write atomic.

CREATE OR REPLACE FUNCTION preferences_deep_merge(
  p_base  JSONB,
  p_patch JSONB,
  p_depth INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB := CASE
    WHEN jsonb_typeof(p_base) = 'object' THEN p_base
    ELSE '{}'::jsonb
  END;
  v_key    TEXT;
  v_value  JSONB;
  v_cur    JSONB;
  v_union  JSONB;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN v_result;
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    v_cur := v_result -> v_key;

    IF p_depth = 0
       AND v_key IN ('unlockedThemes', 'locallyHiddenPosts')
       AND jsonb_typeof(v_value) = 'array' THEN
      SELECT COALESCE(jsonb_agg(d.elem ORDER BY d.src, d.ord), '[]'::jsonb)
      INTO v_union
      FROM (
        SELECT DISTINCT ON (s.elem) s.elem, s.src, s.ord
        FROM (
          SELECT e AS elem, 0 AS src, o AS ord
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(v_cur) = 'array' THEN v_cur ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS t(e, o)
          UNION ALL
          SELECT e, 1, o
          FROM jsonb_array_elements(v_value) WITH ORDINALITY AS t(e, o)
        ) s
        ORDER BY s.elem, s.src, s.ord
      ) d;
      v_result := v_result || jsonb_build_object(v_key, v_union);

    ELSIF jsonb_typeof(v_value) = 'object'
          AND jsonb_typeof(v_cur) = 'object'
          AND p_depth < 8 THEN
      v_result := v_result
        || jsonb_build_object(v_key, preferences_deep_merge(v_cur, v_value, p_depth + 1));

    ELSE
      v_result := v_result || jsonb_build_object(v_key, v_value);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION preferences_deep_merge(JSONB, JSONB, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION preferences_deep_merge(JSONB, JSONB, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION preferences_deep_merge(JSONB, JSONB, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION merge_my_preferences(patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_patch  JSONB;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'merge_my_preferences requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;

  IF patch IS NULL OR jsonb_typeof(patch) <> 'object' THEN
    RAISE EXCEPTION 'merge_my_preferences patch must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  -- Preferences are small (a theme, a few timestamps, id lists). A patch this
  -- large is a client bug or abuse, not a preference change.
  IF octet_length(patch::text) > 65536 THEN
    RAISE EXCEPTION 'merge_my_preferences patch exceeds 64 KiB'
      USING ERRCODE = '22023';
  END IF;

  v_patch := patch - 'feature_flags';

  IF v_patch = '{}'::jsonb THEN
    SELECT u.preferences INTO v_result FROM users u WHERE u.id = v_uid;
  ELSE
    UPDATE users u
    SET preferences = preferences_deep_merge(u.preferences, v_patch),
        updated_at  = NOW()
    WHERE u.id = v_uid
    RETURNING u.preferences INTO v_result;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_my_preferences found no users row for the caller'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION merge_my_preferences(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION merge_my_preferences(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION merge_my_preferences(JSONB) TO authenticated;
