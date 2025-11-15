-- Migration 004: Migrate premium users to professional and add RevenueCat fields
BEGIN;

-- 1. Migrate all 'premium' account types to 'professional'
UPDATE users
SET account_type = 'professional'
WHERE account_type = 'premium';

-- 2. Add RevenueCat integration fields
ALTER TABLE users
ADD COLUMN IF NOT EXISTS revenuecat_subscriber_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_receipt_validation TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS platform VARCHAR(20) CHECK (platform IN ('ios', 'android', 'web', 'desktop'));

-- 3. Add indexes for subscription queries
CREATE INDEX IF NOT EXISTS idx_users_subscription_status ON users(subscription_status)
    WHERE subscription_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_next_billing_date ON users(next_billing_date)
    WHERE next_billing_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_revenuecat_id ON users(revenuecat_subscriber_id)
    WHERE revenuecat_subscriber_id IS NOT NULL;

-- 4. Add constraint to ensure premium is no longer used
-- (Still allow it in CHECK constraint for backward compatibility, but actively migrate away)
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE users
ADD CONSTRAINT users_account_type_check
CHECK (account_type IN ('trial_registered', 'individual', 'professional', 'team'));

COMMIT;
