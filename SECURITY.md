# Security Best Practices

## API Keys and Secrets

**NEVER commit API keys or secrets to Git!**

### For Local Development:
1. Copy `backend/.env.example` to `backend/.env`
2. Fill in your actual API keys
3. The `.env` file is gitignored and will never be committed

### For Production (Fly.io):
Set secrets using Fly.io CLI:

```bash
# OpenRouter API Key
flyctl secrets set OPENROUTER_API_KEY=your-actual-key-here

# OpenAI API Key
flyctl secrets set OPENAI_API_KEY=your-actual-key-here

# JWT Secret
flyctl secrets set JWT_SECRET=your-secure-random-secret

# Verify secrets are set
flyctl secrets list
```

### Getting API Keys:
- **OpenRouter**: https://openrouter.ai/keys
- **OpenAI**: https://platform.openai.com/api-keys

### If You Accidentally Expose a Key:
1. The key will be automatically disabled (OpenRouter/OpenAI scan GitHub)
2. Generate a new key immediately
3. Update Fly.io secrets with the new key
4. Never commit the new key to Git

## Files That Should NEVER Be Committed:
- `.env` files containing real secrets
- `*.p12` (iOS certificates)
- `*.mobileprovision` (iOS provisioning profiles)
- Any file with API keys or passwords

These are all in `.gitignore` to prevent accidental commits.
