-- Switch managed_encryption_key format from hex to base64.
-- No production data exists, so this is a clean cutover.

-- Drop the old hex CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS managed_encryption_key_format;

-- Add new constraint: base64 of exactly 32 bytes = 44 chars, always ends with one '=' pad
ALTER TABLE users ADD CONSTRAINT managed_encryption_key_format
  CHECK (
    managed_encryption_key IS NULL OR
    managed_encryption_key ~ '^[A-Za-z0-9+/]{43}=$'
  );
