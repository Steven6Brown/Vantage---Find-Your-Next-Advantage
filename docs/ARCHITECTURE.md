# Architecture

Next.js (App Router) + TypeScript. One process, no extra services.

```
sources (Adzuna / Greenhouse / Lever)  ->  zod-validated RawJob
  -> matchJob (pure rules, src/lib/match.ts)
  -> dedupe (source+id, and company|title|location across sources)
  -> JSON store (src/lib/store.ts)  ->  dashboard (server component)
                                    ->  email digest (src/lib/digest.ts)
```

Decisions
- **Adzuna + ATS feeds instead of scraping:** LinkedIn/Indeed prohibit scraping; Adzuna is a free, ToS-compliant API.
- **Rule-based matching, no AI:** deterministic, inspectable, no data sent to a model provider.
- **Sources behind a `JobSource` interface:** add sources without touching matching or UI.
- **Storage behind `withStore`/`readStore`:** a serialized, atomic-write JSON file. Swap for a database to deploy on Vercel.
- **Email via plain `fetch` to Resend:** no extra dependency; skipped when unconfigured.
- **`proxy.ts` gate** (Next 16's middleware) protects pages and APIs; `/api/cron` uses its own bearer secret.
- Non-target roles from company boards are never stored.

Accounts (src/lib/accounts.ts, session.ts, password.ts, totp.ts, db.ts, mail.ts)
- **Owner-only accounts in local SQLite** (Node built-in `node:sqlite`, no dependency). Chosen over a hosted auth service because the app is single-user and local; the data layer is behind `accounts.ts` so it can be swapped.
- **Custom auth instead of a library**, deliberately small: scrypt passwords, opaque random session tokens stored hashed, TOTP implemented to RFC 6238 (verified against its test vectors). One new dependency, `qrcode`, to draw the 2FA QR image.
- **Framework-free core.** `accounts.ts` has no Next.js imports so it is unit-tested directly; `session.ts` is the only cookie/redirect glue.
- **One auth API route** (`/api/auth/[action]`) holds origin checks, validation, rate limits and the action handlers.
- **Defence in depth:** the proxy only checks that a cookie exists; every page and API route validates the session against the database.

Deferred: multi-user auth, database, Vercel Cron, resume/gap tooling.
