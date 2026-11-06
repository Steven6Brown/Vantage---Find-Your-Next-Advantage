# Security model

Single-owner app. One account, created on first run. Accounts, sessions and the security log are in a local SQLite file (`data/auth.db`, git-ignored).

## Authentication
- **Passwords:** scrypt (N=32768, r=8, p=1, 16-byte random salt), parameters stored with each hash. Length 12-128, common-password and pattern checks, must not contain the email name. NFKC-normalised.
- **Sign-in:** same work and same message for unknown email and wrong password (no account enumeration). 5 failed attempts lock the account for 15 minutes. Separate failure-only caps per IP and per email (20 per 15 min). Successful sign-ins never count against limits.
- **Two-factor (optional, recommended):** RFC 6238 TOTP, 6 digits, one step of clock drift allowed, replay of an already-used code rejected. Secret is AES-256-GCM encrypted at rest with a key derived (HKDF) from `SESSION_SECRET`. 10 one-time recovery codes, stored as SHA-256 hashes. Wrong codes count toward lockout. Turning 2FA off needs the password plus a code.
- **Email verification:** link valid 24 h, single use. Password reset links are only sent to a verified address.
- **Password reset:** link valid 30 min, single use, only a hash is stored, older links die when a new one is requested. The reset page removes the token from the address bar. Reset signs out every session and sends a notice. Reset does **not** bypass 2FA.
- **Change password / 2FA changes:** require the current password (and a code where relevant); other sessions are signed out; a notice email is sent.
- **Sessions:** 256-bit random token in an HttpOnly, SameSite=Strict cookie (`__Host-` prefixed and Secure in production). Only a SHA-256 hash is stored server-side. Session-only by default (24 h maximum on the server); "Keep me signed in" lasts 30 days; 8 hours idle timeout. A new token is issued after the 2FA step. Sessions are listed on the Security page and can be revoked individually or all at once.
- **Authorization:** every page and API route checks the session against the database. The proxy only does a cheap cookie check for redirects and is not relied on. `/api/cron` uses its own bearer secret (constant-time compare).
- **CSRF:** SameSite=Strict plus an Origin / Sec-Fetch-Site check on every state-changing route.
- **First-run setup:** only possible while no account exists. In production it also requires `SETUP_TOKEN`.
- **Security log:** sign-ins, failures, lockouts, resets, password and 2FA changes, session revocations. Never contains passwords, codes or tokens.

## Other
- Outbound requests only to fixed HTTPS hosts (Adzuna, Greenhouse, Lever, Resend) with timeouts. Board tokens are allowlist-validated.
- Job data is untrusted: schema-validated, HTML stripped, rendered as escaped text, links limited to http(s).
- Headers: CSP, X-Frame-Options, nosniff, Referrer-Policy (no-referrer), Permissions-Policy, `Cache-Control: no-store`.
- Secrets only in environment variables; `.env*`, `data/*.db`, `data/store.json` and `data/settings.json` are git-ignored. Errors returned to clients are generic. Email links use `APP_URL`, never request headers.

- Import: same-origin, signed-in only, rate limited (60 per 10 min), 2 MB and 500 rows per request, every field length-limited and zod-validated; pasted text is shown as plain text; links limited to http(s). A check cannot run twice at once (409) or more than once per 30 seconds (429).
- Data files are written atomically with backups; corrupt files are quarantined, not deleted.

## Known issues and limits
- The CSP allows inline scripts/styles (needed by Next.js without nonces).
- Rate limits are in memory, per process; fine for one instance only. `X-Forwarded-For` is trusted for the IP (correct behind one proxy, spoofable if the app is exposed directly).
- Node's built-in SQLite is marked experimental by Node. A deployment on Vercel would need a hosted database instead.
- No lost-authenticator recovery beyond recovery codes. If both are lost, the owner must reset the account directly in the database file.
- No breached-password lookup (would send a hash prefix to a third party), no email-address change, no account deletion or data export yet.
- Email delivery depends on Resend. Without it, reset and verification links cannot be sent in production (they print to the server terminal in development only).
- No external penetration test or accessibility audit has been done. The automated and live tests are listed in [docs/TESTING.md](docs/TESTING.md).
