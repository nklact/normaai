# Norma AI - Pricing Plans

## Current Pricing Structure

### Trial Plan (Existing)
- **Cost**: Free
- **Messages**: 5 messages total
- **Features**: Basic legal questions only
- **Document Upload**: No
- **Voice Input**: No
- **Support**: Community support only

### Individual Plan (New)
- **Cost**: 3,400 RSD/month or 34,000 RSD/year
- **Messages**: 20 messages per month
- **Features**: Basic legal questions only
- **Document Upload**: No
- **Voice Input**: No
- **Support**: Community support only
- **Target Audience**: Regular users

### Professional Plan (New)
- **Cost**: 6,400 RSD/month or 64,000 RSD/year
- **Messages**: Unlimited
- **Features**: Full legal analysis
- **Document Upload**: Yes (contracts, documents analysis)
- **Voice Input**: Yes (microphone support)
- **Support**: Email support
- **Target Audience**: Lawyers, real estate agents

### Team Plan (New)
- **Cost**: 24,900 RSD/month or 249,000 RSD/year (up to 5 users)
- **Cost**: 29,900 RSD/month or 290,000 RSD/year (up to 5 users, premium tier)
- **Messages**: Unlimited
- **Features**: Full legal analysis + team management
- **Document Upload**: Yes
- **Voice Input**: Yes
- **Support**: Email support + priority support
- **User Management**: Yes (team admin can manage users)
- **Target Audience**: Larger teams and institutions

### Enterprise Plan
- **Cost**: Contact for pricing (for teams with more than 5 users)
- **Features**: All Team features + custom solutions

## Technical Implementation Notes

### Database Schema
- Uses existing `account_type` column with values: `trial_registered`, `individual`, `professional`, `team`, `premium`
- Added `team_id` column for team management
- Reuses existing `trial_messages_remaining` for message limits (renamed conceptually to `messages_remaining`)
- Existing subscription fields handle billing for all plans
- Note: Users must register first to start their free trial

### Plan Features Mapping
- **Message Limits**: Trial (10), Individual (20/month), Professional/Team (unlimited)
- **Document Upload**: Professional, Team only
- **Voice Input**: Professional, Team only
- **Team Management**: Team only

### Monthly vs Yearly Pricing
All plans support both monthly and yearly billing with yearly plans offering approximately 17% discount (equivalent to 2 months free).

## Migration Strategy
- Existing Premium users will be migrated to Professional plan
- All new features will be backward compatible
- No breaking changes to existing API endpoints