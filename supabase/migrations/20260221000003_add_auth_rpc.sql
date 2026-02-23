-- Migration: Add user_has_password RPC
-- Checks if the current authenticated user has a password set.
-- Useful for identifying OAuth-only users who might want to add or change a password.

CREATE OR REPLACE FUNCTION user_has_password()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
-- This next line secures the function against search path hijacking
SET search_path = '' 
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM auth.users 
    WHERE id = auth.uid() 
    AND encrypted_password IS NOT NULL 
    AND encrypted_password != ''
  );
END;
$$;
