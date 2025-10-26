-- Migration: Supabase Auth Integration
-- This migration integrates Supabase Auth with the existing user system
-- It handles user creation, email linking, and trial inheritance

BEGIN;

-- 1. Add auth_user_id column to link to Supabase auth.users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Make password_hash nullable (social login users don't have passwords)
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Add OAuth and user profile columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS oauth_profile_picture_url TEXT;

-- 4. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);

-- 5. Create trigger function to auto-create/link users when they sign up via Supabase
CREATE OR REPLACE FUNCTION handle_new_supabase_user()
RETURNS TRIGGER AS $$
DECLARE
  existing_user_id UUID;
  device_fp VARCHAR(255);
  user_email VARCHAR(255);
  user_name VARCHAR(255);
  provider_name VARCHAR(20);
  avatar_url TEXT;
BEGIN
  -- Extract metadata from Supabase user
  device_fp := NEW.raw_user_meta_data->>'device_fingerprint';
  user_email := NEW.email;
  user_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.email
  );
  avatar_url := NEW.raw_user_meta_data->>'avatar_url';

  -- Determine OAuth provider
  provider_name := CASE
    WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN 'google'
    WHEN NEW.raw_app_meta_data->>'provider' = 'facebook' THEN 'facebook'
    WHEN NEW.raw_app_meta_data->>'provider' = 'apple' THEN 'apple'
    WHEN NEW.raw_app_meta_data->>'provider' = 'email' THEN NULL
    ELSE NULL
  END;

  -- PRIORITY 1: Check for existing trial user by device_fingerprint (convert unregistered -> registered)
  IF device_fp IS NOT NULL THEN
    SELECT id INTO existing_user_id
    FROM public.users
    WHERE device_fingerprint = device_fp
    AND account_type = 'trial_unregistered'
    AND auth_user_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF existing_user_id IS NOT NULL THEN
      -- UPDATE existing trial user to registered
      UPDATE public.users
      SET
        auth_user_id = NEW.id,
        email = user_email,
        email_verified = (NEW.email_confirmed_at IS NOT NULL),
        name = user_name,
        oauth_provider = provider_name,
        oauth_profile_picture_url = avatar_url,
        account_type = 'trial_registered',
        trial_expires_at = NULL,
        updated_at = NOW()
      WHERE id = existing_user_id;

      -- Migrate existing chats from device_fingerprint to user_id
      UPDATE public.chats
      SET user_id = existing_user_id
      WHERE device_fingerprint = device_fp
        AND user_id IS NULL;

      RAISE NOTICE 'Updated trial user % to registered with Supabase auth %, migrated chats', existing_user_id, NEW.id;
      RETURN NEW;
    END IF;
  END IF;

  -- PRIORITY 2: Check if user already exists by email (for email/password account linking)
  SELECT id INTO existing_user_id
  FROM public.users
  WHERE email = user_email
  AND auth_user_id IS NULL
  LIMIT 1;

  IF existing_user_id IS NOT NULL THEN
    -- User exists with email/password - link to Supabase auth
    UPDATE public.users
    SET
      auth_user_id = NEW.id,
      email_verified = (NEW.email_confirmed_at IS NOT NULL),
      oauth_provider = COALESCE(provider_name, oauth_provider),
      oauth_profile_picture_url = COALESCE(avatar_url, oauth_profile_picture_url),
      name = COALESCE(user_name, name),
      device_fingerprint = COALESCE(device_fp, device_fingerprint),
      trial_expires_at = NULL,
      updated_at = NOW()
    WHERE id = existing_user_id;

    RAISE NOTICE 'Linked existing user % to Supabase auth %', existing_user_id, NEW.id;
    RETURN NEW;
  END IF;

  -- PRIORITY 3: No existing user found - create new trial_registered user
  INSERT INTO public.users (
    id,
    auth_user_id,
    email,
    email_verified,
    name,
    oauth_provider,
    oauth_profile_picture_url,
    account_type,
    device_fingerprint,
    trial_messages_remaining,
    trial_started_at,
    trial_expires_at,
    account_status,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    NEW.id,
    user_email,
    (NEW.email_confirmed_at IS NOT NULL),
    user_name,
    provider_name,
    avatar_url,
    'trial_registered',
    device_fp,
    5,
    NOW(),
    NULL,
    'active',
    NOW(),
    NOW()
  );

  RAISE NOTICE 'Created new trial_registered user for Supabase auth %', NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_supabase_user();

-- 7. Create trigger to sync email verification status from Supabase
CREATE OR REPLACE FUNCTION sync_email_verification()
RETURNS TRIGGER AS $$
BEGIN
  -- When Supabase user confirms email, update our users table
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE users
    SET email_verified = true, updated_at = NOW()
    WHERE auth_user_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  EXECUTE FUNCTION sync_email_verification();

COMMIT;
