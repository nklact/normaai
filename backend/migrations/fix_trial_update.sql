-- Fix: Update trigger to UPDATE existing trial users instead of creating duplicates
-- Run this in Supabase SQL Editor

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

      RAISE NOTICE 'Updated trial user % to registered with Supabase auth %, migrated % chats', existing_user_id, NEW.id, (SELECT COUNT(*) FROM public.chats WHERE user_id = existing_user_id);
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
