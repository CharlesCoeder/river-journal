-- Add managed_encryption_key column to users table
-- Used for managed encryption mode: stores a random 32-byte key as hex
-- Column is encrypted at rest by Supabase's built-in encryption
ALTER TABLE users ADD COLUMN managed_encryption_key TEXT;
