# Authentication System Fixes - Complete Implementation Guide

## 🔍 **Problems Identified**

### 1. **Database Schema Mismatch**
- Backend expected `auth_user_id` column but it didn't exist
- Missing OAuth metadata columns (`name`, `oauth_provider`, `oauth_profile_picture_url`)
- Missing soft delete column (`deleted_at`)

### 2. **Duplicate User Creation**
- Frontend called `supabase.auth.signUp()` → Created user in `auth.users`
- Frontend then called `/api/auth/register` → Created DUPLICATE in `public.users`
- No link between the two databases!

### 3. **Trial Logic Broken for Registered Users**
- After registration, `App.jsx` still tried to call `startTrial()`
- This failed with IP_LIMIT_EXCEEDED for users who already had 3 trials
- Newly registered users couldn't send messages or create conversations

### 4. **Trial Not Migrating on Registration**
- Device trial data wasn't carried over when users registered
- Conversations weren't migrated to the user account

---

## ✅ **Fixes Implemented**

### **Fix 1: Database Schema Migration**

**Files Changed:**
- `backend/src/database.rs` (lines 259-512)

**What Changed:**
- Added `auth_user_id UUID UNIQUE` column
- Added `name`, `oauth_provider`, `oauth_profile_picture_url` columns
- Added `deleted_at` column for soft deletes
- Created migration code to add columns to existing databases

---

### **Fix 2: New `/api/auth/link-user` Endpoint**

**Files Changed:**
- `backend/src/simple_auth.rs` (added `link_user_handler`, lines 232-457)
- `backend/src/main.rs` (added route, line 91)

**What It Does:**
1. Extracts `auth_user_id` from Supabase JWT token
2. Checks if user already exists in `public.users`
3. If device trial exists → Upgrades trial to registered + migrates chats
4. If no trial exists → Creates new registered user with 5 messages
5. Returns success with migration count

**Flow:**
```
User signs up/OAuth → Supabase creates auth.users → Frontend calls /api/auth/link-user
→ Backend links auth_user_id → Migrates trial data if exists → User can login
```

---

### **Fix 3: Frontend Integration**

**Files Changed:**
- `src/services/api.js`
  - Updated `register()` to call `link-user` after signup (lines 189-211)
  - Updated `login()` to call `link-user` on login (lines 277-280)
  - Added `linkOAuthUser()` helper function (lines 673-707)
  - Updated all OAuth flows (Google, Apple, desktop, mobile) to call `linkOAuthUser()`

**What Changed:**
- Email/password registration now properly links to backend
- OAuth (Google/Apple) now links to backend on all platforms
- Trial data automatically migrates on first link
- Conversations carry over from device trial to registered account

---

### **Fix 4: App.jsx Initialization Logic**

**Files Changed:**
- `src/App.jsx` (lines 172-210)

**What Changed:**
- **BEFORE:** Called `startTrial()` even for logged-in users → IP limit errors
- **AFTER:** Only calls `startTrial()` if:
  - User has NO Supabase session (`!hasToken`)
  - AND no trial exists (`messages_remaining === null`)

**Result:**
- Logged-in users skip trial creation
- Anonymous users get trial on first visit
- Trial only created once per device fingerprint

---

### **Fix 5: OAuth Callback Handling**

**Files Changed:**
- `src/App.jsx` (lines 147-150)

**What Changed:**
- When OAuth callback completes on web, immediately link user to backend
- Ensures trial migration happens before user starts using the app

---

## 📋 **Required Manual Steps**

### **Step 1: Run SQL Migration in Supabase**

1. Open **Supabase Dashboard** → **SQL Editor**
2. Copy and paste the contents of `SUPABASE_MIGRATION.sql`
3. Click **Run**
4. Verify columns were added by running the verification query at the bottom

**Expected Output:**
```
column_name                 | data_type                | is_nullable
----------------------------+--------------------------+-------------
auth_user_id                | uuid                     | YES
deleted_at                  | timestamp with time zone | YES
name                        | character varying        | YES
oauth_profile_picture_url   | text                     | YES
oauth_provider              | character varying        | YES
trial_messages_remaining    | integer                  | YES
```

---

### **Step 2: Deploy Backend**

The backend migration will run automatically on next deployment:
```bash
# Backend will automatically run migrations in database.rs
# No manual intervention needed - just deploy!
```

---

### **Step 3: Test the Flows**

#### **Test 1: Anonymous Trial User**
1. Open app in incognito/private window
2. Should create trial with 5 messages
3. Send a message → Works ✅
4. Refresh page → Trial persists ✅
5. Check database:
   ```sql
   SELECT device_fingerprint, account_type, trial_messages_remaining, auth_user_id
   FROM public.users
   WHERE account_type = 'trial_unregistered';
   ```
   - Should show device fingerprint, 4 messages remaining, `auth_user_id` is NULL

#### **Test 2: Email/Password Registration**
1. From trial window above, click "Register"
2. Enter email/password → Submit
3. Check console for:
   - `✅ OAuth user linked to backend`
   - `🔄 Migrated X trial chats to registered account`
4. Should have same conversations from trial
5. Check database:
   ```sql
   SELECT email, account_type, trial_messages_remaining, auth_user_id
   FROM public.users
   WHERE email = 'test@example.com';
   ```
   - Should show `account_type = 'trial_registered'`
   - Should have `auth_user_id` populated (UUID from auth.users)
   - Should have 4 messages remaining (carried over from trial)

#### **Test 3: Email/Password Login**
1. Logout from registered account
2. Login with same email/password
3. Should see same conversations ✅
4. Should have same message count ✅
5. Check console - no `startTrial()` calls ✅

#### **Test 4: Google OAuth**
1. Open app in new incognito window
2. Use trial, send 1 message
3. Click "Sign in with Google"
4. Complete OAuth flow
5. Check console for migration message
6. Should have trial conversation + 4 messages remaining ✅

---

## 🎯 **Expected Behavior After Fixes**

### **First Visit (Anonymous)**
```
App opens → No Supabase session → Check device_fingerprint
→ No trial exists → Call startTrial()
→ Create public.users row (account_type=trial_unregistered, auth_user_id=NULL)
→ User can send 5 messages
```

### **Registration (Email/Password)**
```
User clicks Register → Frontend calls supabase.auth.signUp()
→ Supabase creates auth.users row → Returns session + access_token
→ Frontend calls /api/auth/link-user with token + device_fingerprint
→ Backend finds trial user by device_fingerprint
→ Updates trial user: auth_user_id=<supabase_id>, account_type=trial_registered
→ Migrates chats: UPDATE chats SET user_id=<user_id> WHERE device_fingerprint=<fp>
→ User now has registered account with trial data migrated
```

### **Registration (OAuth)**
```
User clicks "Sign in with Google" → OAuth flow completes
→ Supabase creates auth.users row → Returns session
→ Frontend calls /api/auth/link-user
→ Backend reads OAuth metadata (name, avatar, provider) from auth.users
→ Same migration logic as email/password
→ User has registered account with OAuth profile
```

### **Future Logins**
```
User logs in → Supabase validates credentials → Returns session
→ Frontend calls /api/auth/link-user (idempotent - safe to call multiple times)
→ Backend finds existing public.users row by auth_user_id
→ Returns user data immediately (no migration needed)
→ App loads user's conversations and message count
```

---

## 🐛 **Debugging Guide**

### **Issue: "IP_LIMIT_EXCEEDED" on Registration**
**Cause:** You've created 3+ trial users from the same IP
**Fix:** This is CORRECT behavior! Show the auth modal to force registration
**Verify:**
```sql
SELECT ip_address, count FROM public.ip_trial_limits;
```

### **Issue: User Can't Send Messages After Registration**
**Symptoms:** getUserStatus returns null or no messages_remaining
**Debug:**
```sql
-- Check if user exists in public.users
SELECT id, auth_user_id, email, account_type, trial_messages_remaining
FROM public.users
WHERE email = 'user@example.com';

-- Check if user exists in auth.users
SELECT id, email FROM auth.users WHERE email = 'user@example.com';
```

**Fix:** If `auth_user_id` is NULL, user wasn't linked properly:
```sql
-- Get the auth_user_id from Supabase
SELECT id FROM auth.users WHERE email = 'user@example.com';

-- Manually link (replace UUIDs with actual values)
UPDATE public.users
SET auth_user_id = '<auth_user_id_from_above>'
WHERE email = 'user@example.com';
```

### **Issue: Trial Created Every Time App Opens**
**Symptoms:** Multiple rows in public.users with same device_fingerprint
**Debug:**
```sql
SELECT device_fingerprint, COUNT(*)
FROM public.users
GROUP BY device_fingerprint
HAVING COUNT(*) > 1;
```

**Cause:** `startTrial()` logic not checking existing trials properly
**Verify Fix:** Check `simple_auth.rs:1414-1441` - should return existing trial

---

## 📊 **Database Queries for Monitoring**

### **Check Trial Usage by IP**
```sql
SELECT ip_address, count, created_at
FROM public.ip_trial_limits
ORDER BY created_at DESC
LIMIT 10;
```

### **Find Unlinked Users (Missing auth_user_id)**
```sql
SELECT id, email, account_type, device_fingerprint
FROM public.users
WHERE account_type != 'trial_unregistered'
  AND auth_user_id IS NULL;
```

### **Check Trial Migration Status**
```sql
-- Users who registered
SELECT email, account_type, trial_messages_remaining, auth_user_id
FROM public.users
WHERE account_type = 'trial_registered';

-- Their migrated chats
SELECT u.email, c.title, c.created_at
FROM public.users u
JOIN public.chats c ON c.user_id = u.id
WHERE u.account_type = 'trial_registered'
ORDER BY c.created_at DESC;
```

---

## ✅ **Success Criteria**

- [ ] SQL migration runs without errors
- [ ] Anonymous users can start trial and send 5 messages
- [ ] Trial persists on page refresh (no duplicate trials)
- [ ] Email/password registration links to backend
- [ ] OAuth (Google/Apple) registration links to backend
- [ ] Trial conversations migrate to registered account
- [ ] Message count carries over from trial to registered
- [ ] Logged-in users don't trigger trial creation
- [ ] IP limit (3 trials) works correctly
- [ ] No "IP_LIMIT_EXCEEDED" errors for registered users
- [ ] Conversations persist across logout/login

---

## 🔐 **Security Notes**

1. **Device Fingerprint:** Used only for trial tracking, not for authentication
2. **IP Limiting:** Prevents abuse, but doesn't block registered users
3. **Auth Flow:** Supabase handles all password hashing, session management
4. **Token Verification:** Backend validates Supabase JWT on every request
5. **Chat Isolation:** Users can only access their own chats (by user_id or device_fingerprint)

---

## 📝 **Summary**

The authentication system now has a **clean, unified architecture**:
- **Supabase Auth** handles all authentication (email, OAuth)
- **Backend** handles business logic (trials, subscriptions)
- **public.users** is linked to **auth.users** via `auth_user_id`
- **Trial migration** happens automatically on first registration/login
- **No duplicate trial creation** for logged-in users
- **Clean separation** between anonymous and registered users

All bugs should now be fixed! 🎉
