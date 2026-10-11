# Strict Security & Secrets Management Rule

## ZERO-TOLERANCE POLICY: NO HARDCODED SECRETS OR CREDENTIALS
Under NO circumstances may any developer, AI agent, script, or automated process commit or hardcode sensitive credentials, connection strings, or environment secrets into ANY repository file.

---

### 1. Strictly Prohibited Elements
The following must **NEVER** appear in plain text in repository files (including code, tests, docs, scripts, Dockerfiles, and CI/CD workflow YAMLs):
- **Database Connection Strings & Credentials:** E.g., `postgresql://user:password@host...`, database passwords, usernames, Amazon RDS hostnames with embedded auth.
- **Cryptographic Keys & Tokens:** Private keys (`-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----`), JWT secrets, HMAC signing secrets, token vault symmetric encryption keys (AES keys).
- **Payment Gateway Keys & Secrets:** Stripe secret keys (`sk_live_...`, `rk_live_...`), Razorpay key secrets (`rzp_live_...`), webhook secrets.
- **Third-Party Provider API Keys:** Cartesia, OpenAI, Anthropic, ElevenLabs, AWS Access/Secret keys (`AKIA...`), Google OAuth client secrets, Meta/Instagram/Threads/TikTok app secrets.
- **Production Server Passwords & SSH Keys:** EC2 passwords, SSH private keys (`id_rsa`, `*.pem`), Cloudflare API tokens, etc.

---

### 2. Mandatory Secret Ingestion Patterns
1. **Application Code:**
   Always retrieve secrets dynamically via environment variables:
   ```ts
   const dbUrl = process.env.CORE_DATABASE_URL;
   if (!dbUrl) {
     if (process.env.NODE_ENV === 'production') {
       throw new Error('CRITICAL: CORE_DATABASE_URL environment variable is missing.');
     }
     // Safe local development fallback ONLY
     dbUrl = 'postgresql://postgres:postgres@localhost:5432/180core_db?schema=public';
   }
   ```
2. **Strict Fallback Prohibition:**
   Never provide a real credential, live database string, or production password as a fallback (`|| 'real-secret'`). In development, use standard non-sensitive localhost dummies or fail loudly with a descriptive error.
3. **CI/CD Workflows:**
   Pass secrets strictly using GitHub Actions repository secrets:
   ```yaml
   env:
     CORE_DATABASE_URL: ${{ secrets.CORE_DATABASE_URL }}
     DEVELOPERS_DATABASE_URL: ${{ secrets.DEVELOPERS_DATABASE_URL }}
     SOCIAL_TOKEN_ENCRYPTION_KEY: ${{ secrets.SOCIAL_TOKEN_ENCRYPTION_KEY }}
   ```
   **NEVER** use inline `printf 'SECRET=...' >> .env` with plaintext credentials in workflow scripts.
4. **Local Development:**
   Store secrets only in git-ignored `.env` or `.env.local` files. Never commit `.env` or `prod.env`.
5. **Cryptographic Key Pairs:**
   Generate RSA/asymmetric key pairs at runtime in-memory or store them in a secure KMS/vault or securely ignored local storage (`packages/keys/` excluded in `.gitignore`).

---

### 3. File System & `.gitignore` Enforcement
The following must **ALWAYS** remain strictly ignored in `.gitignore`:
- `.env`, `.env.*`, `*.env`, `prod.env` (only `.env.example` templates may be committed)
- `*.pem`, `*.key`, `*.pfx`, `*.cert`, `*.crt`
- `packages/keys/`, `keys/`, `oauth-rsa-key.json`, `*-key.json`
- `*service-account*.json`, `google-services.json`

---

### 4. Violation Action
Any automated tool, linter, or AI agent detecting hardcoded secrets must halt and immediately sanitize the file before committing or applying changes.
