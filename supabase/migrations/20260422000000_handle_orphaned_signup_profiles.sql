CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove stale app-profile rows left behind when an auth user was deleted.
  -- This avoids users_email_key failures when the same email signs up again
  -- and the old public.users row has no matching auth.users record.
  DELETE FROM public.users u
  WHERE u.email = NEW.email
    AND u.id <> NEW.id
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users au
      WHERE au.id = u.id
    );

  INSERT INTO public.users (
    id,
    email,
    role,
    user_type,
    company_name,
    email_verified,
    last_login_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'builder'),
    COALESCE(NEW.raw_user_meta_data->>'user_type', 'community_builder'),
    NEW.raw_user_meta_data->>'company_name',
    NEW.email_confirmed_at IS NOT NULL,
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
