# Fly.io Secrets Configuration for Norma AI

## Required Environment Variables

Based on your backend configuration, you need these secrets set in Fly.io:

### 1. OpenRouter API Key
```bash
flyctl secrets set OPENROUTER_API_KEY=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
```

### 2. OpenAI API Key (for transcription)
```bash
flyctl secrets set OPENAI_API_KEY=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
```

### 3. JWT Secret (if needed)
```bash
flyctl secrets set JWT_SECRET=your-secure-jwt-secret-here
```

### 4. Database URL (if needed)
```bash
flyctl secrets set DATABASE_URL=your-postgres-connection-string
```

## Verify Secrets
```bash
flyctl secrets list
```

## Notes
- These secrets are already configured in your backend code (`backend/src/main.rs`)
- Frontend code no longer contains hardcoded API keys (security fixed)
- All API requests go through your secure backend