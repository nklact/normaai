# Account Deletion Auto-Restore Fix

## 🐛 **Bug Identified:**

When a user soft-deleted their account and then logged in again, they saw:
- ✅ "Successfully signed in" message
- ❌ Frontend showed them as logged out (trial user with no data)
- ❌ Account was not restored

## 🔍 **Root Cause:**

The `link_user_handler` endpoint (called after Supabase login) was:
1. Finding the user by `auth_user_id` ✅
2. **NOT checking if the user was soft-deleted** ❌
3. Returning success without restoring the account ❌
4. `getUserStatus` then couldn't find the user (because `account_status = 'deleted'`)
5. Frontend received empty trial user status

## ✅ **Fix Applied:**

**File:** `backend/src/simple_auth.rs` (lines 328-361)

Added auto-restore logic to `link_user_handler`:

```rust
let (user_id, migrated_chats) = if let Some(user) = existing_user {
    // Check if user is deleted and within grace period - auto-restore
    if user.account_status == "deleted" {
        if let Some(deleted_at) = user.deleted_at {
            let grace_period_ends = deleted_at + chrono::Duration::days(30);
            if chrono::Utc::now() < grace_period_ends {
                // Auto-restore user on login
                crate::database::restore_user(user.id, &pool).await?;
                println!("✅ Auto-restored deleted account for user {}", user.email);
            } else {
                // Grace period expired
                return Err(ACCOUNT_PERMANENTLY_DELETED);
            }
        }
    }

    // User already linked (and restored if needed)
    (user.id, None)
}
```

## 📋 **How It Works Now:**

### **Soft Delete Flow:**
1. User clicks "Delete Account"
2. Backend sets `account_status = 'deleted'`, `deleted_at = NOW()`
3. User sees: "Account scheduled for deletion. You have 30 days to restore."

### **Auto-Restore Flow:**
1. User logs in (email/password or OAuth)
2. Supabase authenticates successfully ✅
3. Frontend calls `/api/auth/link-user` with session token ✅
4. Backend finds user by `auth_user_id` ✅
5. **Backend checks if user is deleted:**
   - If within 30 days → Auto-restore account ✅
   - If after 30 days → Return "Account permanently deleted" error ❌
6. `getUserStatus` returns active user data ✅
7. Frontend shows user as logged in with all data ✅

## 🧪 **Testing:**

### **Test 1: Restore within grace period**
1. Login → Delete account
2. Immediately login again
3. ✅ Expected: Account auto-restored, user sees their data
4. ✅ Check backend logs for: `✅ Auto-restored deleted account for user [email]`

### **Test 2: Grace period expired**
1. Manually set `deleted_at` to 31 days ago in database:
   ```sql
   UPDATE users
   SET deleted_at = NOW() - INTERVAL '31 days'
   WHERE email = 'test@example.com';
   ```
2. Try to login
3. ✅ Expected: "Account permanently deleted" error
4. ❌ User cannot login

### **Test 3: Manual restore endpoint**
1. Login → Delete account
2. Call `POST /api/auth/restore-account` with token
3. ✅ Expected: Account restored, returns user status
4. ✅ User can use app normally

## 🔐 **Security:**

- ✅ Only users within 30-day grace period can be restored
- ✅ After 30 days, account cannot be recovered
- ✅ Restoration requires valid Supabase session (JWT token)
- ✅ Auto-restore happens transparently on login
- ✅ Manual restore endpoint also available

## 📊 **Database Queries for Monitoring:**

### **Check deleted users within grace period:**
```sql
SELECT id, email, deleted_at,
       (deleted_at + INTERVAL '30 days') as grace_period_ends,
       NOW() < (deleted_at + INTERVAL '30 days') as can_restore
FROM users
WHERE account_status = 'deleted'
ORDER BY deleted_at DESC;
```

### **Find users with expired grace period (ready for cleanup):**
```sql
SELECT id, email, deleted_at
FROM users
WHERE account_status = 'deleted'
  AND deleted_at < NOW() - INTERVAL '30 days';
```

---

## ✅ **Status: Fixed!**

Users can now:
- Soft-delete their account
- Log in within 30 days → Account auto-restored
- Continue using the app with all data intact
- After 30 days → Account permanently deleted (cleanup job handles this)
