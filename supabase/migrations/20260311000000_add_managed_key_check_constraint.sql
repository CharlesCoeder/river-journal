-- Normalize any existing uppercase hex keys to lowercase
UPDATE users SET managed_encryption_key = lower(managed_encryption_key)
WHERE managed_encryption_key IS NOT NULL;

-- Enforce that managed_encryption_key is either NULL or exactly 64 lowercase hex chars (32 bytes)
ALTER TABLE users ADD CONSTRAINT managed_encryption_key_format
  CHECK (
    managed_encryption_key IS NULL OR
    managed_encryption_key ~ '^[0-9a-f]{64}$'
  );
