-- Migration: Auto-create public.users row on auth signup
-- Ensures the FK from daily_entries.user_id → users.id is satisfied
-- before sync can insert entries.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger AS
$$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Back-fill any auth users that already exist but are missing from public.users
INSERT INTO public.users (id)
SELECT id FROM auth.users
WHERE id NOT IN (SELECT id FROM public.users)
ON CONFLICT (id) DO NOTHING;
