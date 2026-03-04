-- Migration: Add updated_at triggers and is_deleted for Legend-State sync
-- Required by changesSince: 'last-sync' to detect row changes and soft deletes.

-- daily_entries needs is_deleted for changesSince: 'last-sync' fieldDeleted requirement
ALTER TABLE daily_entries
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- COALESCE preserves client-provided created_at (e.g. the actual writing time
-- for flows synced later) while defaulting to now() when not provided.
CREATE OR REPLACE FUNCTION handle_times()
  RETURNS trigger AS
$$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
  ELSEIF (TG_OP = 'UPDATE') THEN
    NEW.created_at = OLD.created_at;
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON daily_entries
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();

CREATE TRIGGER handle_times
  BEFORE INSERT OR UPDATE ON flows
  FOR EACH ROW
EXECUTE PROCEDURE handle_times();
