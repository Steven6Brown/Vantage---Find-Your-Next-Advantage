# Development notes

The app name is set in `src/lib/brand.ts`. Do not change the HKDF salt in `src/lib/totp.ts` (it would break saved 2FA secrets).

Follow `Templates/Aquila-Digital-Mobile-Web-App-Build-Standards-MASTER-UPDATED.docx`.

- Finds and ranks listings only. Never add auto-apply or scraping of LinkedIn/Indeed.
- Business rules live in `src/lib/match.ts`; keep them pure and tested (`npm test`).
- Treat all source data as untrusted; validate with zod; no new dependencies/services without a confirmed requirement.
- Job explanations (`src/lib/explain.ts`) must stay evidence-based: every claim pairs a resume line with posting text; say "not stated" instead of guessing.
- Auth: every page and API route must call `requireSession()` / `sessionFromRequest()` itself (the proxy is not authorization). Never log or return passwords, codes, tokens or secrets. Keep `accounts.ts` free of Next.js imports. New state-changing routes need `sameOrigin()`.
- Accessibility (WCAG 2.2 AA): only use the color tokens in `globals.css` (every pair was measured; do not add greys below 4.5:1 for text or 3:1 for control borders). Never put information in hover-only tooltips, never rely on color alone, keep text at 14 px or larger, give every page a unique title and one h1, and keep names that contain their visible text. Check changes in both themes.
- Visual identity: light = ledger (restrained, tight corners), dark = brand forward. Use the brand gradient sparingly: logo, score meters, chart bars and the single line atop each page. Do not add it as decoration elsewhere. Radii come from `--r-sm` and `--r-md`, which differ per theme. Check changes in both themes and in both row densities.
- Never commit `.env*` or `data/store.json`. Do not claim tests or reviews that were not run.
- Storage is a local JSON file; Vercel deployment needs a database swap in `src/lib/store.ts`.
