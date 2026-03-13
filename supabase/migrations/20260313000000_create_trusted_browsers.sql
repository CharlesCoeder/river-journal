-- Trusted Browsers: Web E2E key persistence registry
-- Allows web users to opt-in to storing their E2E encryption key in IndexedDB,
-- wrapped by a non-extractable Web Crypto KEK. Server stores only SHA-256 hashes
-- of device tokens for verification and revocation.

CREATE TABLE trusted_browsers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token_hash TEXT        NOT NULL UNIQUE,
  label             TEXT        NOT NULL DEFAULT 'Web Browser',
  platform          TEXT        NOT NULL DEFAULT 'web',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trusted_browsers_user_id ON trusted_browsers(user_id);
CREATE INDEX idx_trusted_browsers_device_token_hash ON trusted_browsers(device_token_hash);

-- RLS
ALTER TABLE trusted_browsers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own trusted browsers"
  ON trusted_browsers FOR SELECT
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can register their own trusted browsers"
  ON trusted_browsers FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can revoke their own trusted browsers"
  ON trusted_browsers FOR DELETE
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Users can update their own trusted browsers"
  ON trusted_browsers FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- Enforce max 10 trusted browsers per user (advisory lock serializes concurrent inserts)
CREATE OR REPLACE FUNCTION enforce_max_trusted_browsers()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::text));
  IF (SELECT COUNT(*) FROM trusted_browsers WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'Maximum of 10 trusted browsers per user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_max_trusted_browsers
  BEFORE INSERT ON trusted_browsers
  FOR EACH ROW EXECUTE FUNCTION enforce_max_trusted_browsers();

-- Prevent mutation of immutable columns on UPDATE
CREATE OR REPLACE FUNCTION prevent_trusted_browser_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.device_token_hash IS DISTINCT FROM OLD.device_token_hash
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Cannot modify immutable columns on trusted_browsers';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_trusted_browser_mutation
  BEFORE UPDATE ON trusted_browsers
  FOR EACH ROW EXECUTE FUNCTION prevent_trusted_browser_mutation();

-- Stale row cleanup (browsers where IndexedDB was cleared but server row persists)
CREATE OR REPLACE FUNCTION cleanup_stale_trusted_browsers()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM trusted_browsers
  WHERE last_used_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restrict execution to service role only
REVOKE EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() FROM authenticated;
GRANT EXECUTE ON FUNCTION cleanup_stale_trusted_browsers() TO service_role;

-- Schedule daily cleanup at 3:00 AM UTC via pg_cron
SELECT cron.schedule(
  'cleanup-stale-trusted-browsers',
  '0 3 * * *',
  $$SELECT cleanup_stale_trusted_browsers()$$
);
