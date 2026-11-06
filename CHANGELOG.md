# Changelog

## 0.10.0 - 2026-11-06
- Import applications: a new Import page adds jobs you applied to elsewhere (Indeed, a spreadsheet, a typed list or one at a time). Upload a CSV, paste a list, or add one. Columns are matched automatically and can be changed, and a preview shows what will be new, already in your list, or already applied before anything is saved. Imported jobs show an "Imported" label, appear under Applied with the day you applied, and are never added again by later checks.
- Matching an import against your list uses the Indeed link, then company and title (with city matching, so "Akron, OH" equals "Akron, Summit County").
- Foundation hardening found by stress testing: concurrent saves can no longer overwrite each other; an unreadable store or settings file is moved aside (never deleted) and the dashboard says so; saves retry when OneDrive briefly locks a file; a Check now button pressed twice (or a check running at the same time as the daily job) is blocked instead of doubling requests; backups (.bak) are kept next to each data file. The data folder can be moved with the DATA_DIR setting.
- Tests: 392 passing (importer fuzzing, route abuse, concurrency, corrupt-file recovery, 3,000-opening performance).

## 0.9.0 - 2026-11-05
- Two distinct looks. Light is a tidy ledger style (crisp 4 and 8 px corners, hairline rules). Dark is brand-forward: true graphite greys, 8 and 14 px corners, more breathing room, and the green-to-blue gradient used on purpose (the logo, score meters, chart bars and a thin line across the top of every page).
- Compact rows: a Compact button in the sidebar tightens the openings table (smaller padding, monospaced scores) so more openings fit on screen; remembered on the device.
- Table fixes: it now fits at 1366 px and 1440 px without clipping, the Details column stays pinned on the right, pay stays on one line, and the stacked card layout starts below 1280 px.
- Dark palette re-measured for WCAG contrast; every pair passes.

## 0.8.0 - 2026-11-05
- Accessibility and readability pass. Measured WCAG contrast first and fixed real failures (dim secondary text at 3.96:1 and form-field borders at 1.75:1 now pass). Type is larger (16 px base, 15 px table), colors rebuilt as tested tokens, and a Light and Dark theme with an Auto/Light/Dark toggle (remembered on the device, applied before first paint).
- Chart bars no longer rely on color alone: solid (fit), striped (stretch) and outlined (poor fit).
- Every row has a visible Details button (the title still toggles it too).
- The explanation panel was redesigned for reading: verdict first, reasons and watch-outs on the left, resume evidence on the right in whole sentences with the matched words highlighted; excerpts now start and end on sentence boundaries instead of mid-word.
- Indeed-style filters: search box plus chips for Date posted, Pay, Job type, Experience level, Work setting (Remote, Hybrid, On-site), Company, Job category, Match, and Sort by, with counts, a highlighted chip when active, and Clear all. Pay and job type are now captured from Adzuna and filled in for older listings the next time they are seen.
- Page titles on every screen, a Pay column, and the logo link name now contains its visible text (WCAG 2.5.3).

## 0.7.0 - 2026-11-05
- Renamed to Vantage and redesigned as an enterprise-style app: left navigation rail (top bar on phones), an Openings page with a Market view skyline (one bar per opening, height is match score, click to open the row), a sortable table where each row expands to the explanation, a status dropdown per row, and a split-screen sign-in with the same skyline. New design system in globals.css (black and graphite neutrals from the portfolio, green actions, blue focus, amber stretch).
- Table sorting by opening, match and date found; stacked card layout below 1120 px.
- Project moved to Web Applications/vantage.

## 0.6.0 - 2026-11-05
- Renamed to Job Radar (name set in src/lib/brand.ts).
- Dashboard: a What's being searched summary (job titles, area, sources, what is kept and never kept), a filter bar (job type with counts, remote or near me, fit level, title/company search) and job-type and location tags on every card.
- Settings: editable search terms (1 to 12 job titles, with quick-add suggestions and a request-count estimate).

## 0.5.1 - 2026-11-05
- Header, sign-in pages and browser tab now use the real "SB" logo from the portfolio (resized copies: `public/logo.png`, `src/app/icon.png`). The logo and icon load before sign-in.

## 0.5.0 - 2026-11-05
- Replaced the shared passphrase with a real owner account: first-run setup, sign in and sign out, email verification, forgot/reset password, change password, account lockout, rate limits, optional authenticator-app 2FA with recovery codes, session list and revocation, security activity log. Local SQLite (Node built-in) for accounts and sessions; Resend for email.
- Every page and API route now validates the session against the database (the proxy only does a cookie check).

## 0.4.0 - 2026-11-05
- Info button on every job card: a bottom-line verdict, why it fits, your resume lines matched against the posting's own wording, supporting resume entries, degree and cert notes, watch-outs, and what the posting text does not confirm. Rule-based, no AI.

## 0.3.0 - 2026-11-05
- Internal resume parsing engine: splits sections, reads jobs/projects with dates and bullets, learns skills and tools from the resume itself (Skills section, lists, parentheses) plus a built-in security vocabulary, finds degree level, certs and training. Re-upload after editing the resume to refresh.

## 0.2.0 - 2026-11-04
- Search area: ZIP or City, ST plus radius, with "Save as my default".
- Settings page: local rule-based resume reader (PDF/DOCX/TXT), editable certifications; resume skills add to match scores.
- Restyled to the stevenrbrown.org look (black, DM Sans, green-to-blue accent). Adzuna search trimmed to 3 terms for the 25-call test key.

## 0.1.0 - 2026-11-04
- Initial build: Adzuna + Greenhouse/Lever sources, rule-based matcher with gap flags, dedupe, JSON store, passphrase-protected dashboard, optional Resend digest, local `npm run check`.
