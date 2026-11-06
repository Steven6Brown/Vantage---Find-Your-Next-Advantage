# Testing

Performed (2026-11-04)
- 13 unit tests for matching, cert/year extraction, dedupe normalization: pass.
- Type check and production build: pass.
- Against a production server: unauthenticated page redirects to /login; unauthenticated API and /api/cron return 401; bad login 401; good login sets session; invalid status body 400; cross-origin POST 403; security headers present.
- Pipeline with mock sources: physical-security title excluded, cross-source duplicate merged, second run added 0, senior/cert/years/location mismatches classified.

Added 2026-11-04 (location, resume, restyle)
- 21 unit tests total pass (resume extraction, skill matching, location validation, near-search classification).
- Production build: a generated one-page PDF was uploaded through `/api/resume` and its skills, cert and years were detected; a fake .pdf, an oversized file, and an unsafe location were rejected.
- Live Adzuna check worked for the user (6 of 25 test calls per check).
- Visual check of the dashboard and Settings in the browser; a phone-width overflow on the file picker was found and fixed.

Added 2026-11-05 (resume parser)
- 29 unit tests pass, including section splitting, wrapped lines, terms learned outside any built-in list, evidence lines, date math with overlaps, contact-detail removal, and re-parsing after a resume change.
- Run on the real resume PDF: 60 skills and tools, 6 experience and 4 project entries with dates, degree and training found, no contact details stored. Known gaps: a tool named only inside a longer sentence (e.g. Elementor) can be missed; a date range with no year on its first date is not counted.

Added 2026-11-05 (info button)
- 37 unit tests pass, including the explanation builder (verdict line, resume-vs-posting evidence, degree and cert notes, gaps, not-stated items, partial Adzuna text, no-resume case).
- Checked in the browser against real Adzuna listings and the real resume: the Info button appears on all 9 review cards and opens the panel with evidence lines.

Added 2026-11-05 (accounts and sign-in)
- 80 unit tests pass in total. The auth ones cover scrypt hashing and the password policy, the RFC 6238 test vectors, replay protection, secret encryption, owner-only creation, lockout and unlock, session expiry (idle and absolute), revocation, single-use and expiring tokens, recovery codes, 2FA enrol/disable, and the failure-only rate limiter.
- 69 live checks against a production build with a throwaway database, all passing: first-run redirect; setup refused with a wrong token, weak or mismatched password, and a second account refused; forged cookies rejected on pages and APIs (checked against the database); logout kills the session server-side; identical errors for wrong password and unknown email; cross-origin POST refused; lockout; email verification and its single use; password change signs out other devices; forgot-password replies identically for known and unknown emails; reset link single-use, expiring, signs out all sessions, weak password refused without using the link; 2FA enrolment, half-signed-in session unusable, code replay refused, recovery code single-use, reset does not bypass 2FA, 2FA off needs password and code; audit log has the key events and no secrets.
- Browser check of the sign-in card and Security page at desktop and phone width (no sideways scroll), and the Sign out button.
- Found and fixed during testing: the sign-in limiter counted successful logins; the sign-in card styling.

Added 2026-11-05 (job types, filters, search terms, rename)
- 107 unit tests pass in total; the new ones cover job-type classification, filter parsing and combination, counts, and search-term validation (unsafe characters, size limits, duplicates). A bug in duplicate handling was found by these tests and fixed.
- Browser check against the real saved listings: the summary shows the right titles, area and sources; job-type counts match; SOC + remote + stretch returns exactly the 3 expected listings; an empty filter result shows a message; search terms save, dedupe and reject unsafe input; the new name shows in the tab and header.

Added 2026-11-05 (Vantage redesign)
- 113 unit tests pass in total; new ones cover sorting (by match, company, title and date, ascending and descending, URL parsing, direction flip, original list unchanged).
- Checked in the browser against the real saved listings with a throwaway account: sign-in and setup screens, the Openings page at desktop (1440), 1024 and phone (375) widths with no sideways scroll, clicking a Market view bar opens and scrolls to its row, the row explanation, Settings, and the phone top bar. Problems found and fixed: the table overflowed at 8 columns (merged to 6), a stray scrollbar on the tabs, sparse-looking bars, sign-in text overlapping the skyline, and a phone top bar that pushed Security and Sign out offscreen.

Added 2026-11-05 (accessibility, readability, Indeed-style filters)
- 140 unit tests pass in total; the new ones cover work setting, job type, experience level, pay and posting-date logic, every filter and combinations, option counts, URL parsing that rejects unknown values, and the sentence-boundary excerpts with highlighting.
- Contrast measured with the WCAG formula before choosing colors. The previous design failed in two places (secondary text 3.96:1 against a 4.5:1 minimum; form-field borders 1.75:1 against 3:1). The new dark and light colors all pass; the one light-mode amber bar that failed was darkened.
- Automated audit with axe-core 4.14 (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA and best practices), run in the browser against a production build in both themes: Create account, Sign in, Openings (a row expanded), Settings and Security at desktop width, and Openings at phone width. Final result: 0 violations on every page. It found one real issue (the logo link's spoken name did not contain its visible text, WCAG 2.5.3) and one unlabelled-region problem on Settings; both were fixed and re-run. How to repeat: copy node_modules/axe-core/axe.min.js into public/, load it in the page, call axe.run, then delete the copy.
- Keyboard check of the filter menus in the browser: Enter opens (aria-expanded), Tab moves into the options, Escape closes and returns focus to the chip.
- Filters checked against the real saved listings (for example Mid level returns the three II / 3+ year openings; Contract returns the one 3 Years Contract opening).
- Items axe could not decide (elements partly under an open menu or scrolled off a phone edge) were inspected by hand and are not problems.
- Hover-only information was removed (a tooltip that showed resume lines); the same evidence is in each opening's Details.

Added 2026-11-05 (styling directions and compact rows)
- Dark palette re-measured against WCAG before use (text, muted, faint, links, control borders, pills on tinted backgrounds, focus ring): every pair passes.
- axe-core 4.14 re-run on the Openings page in all four combinations (dark and light, roomy and compact) and on Sign in in both themes: 0 violations and nothing left to review.
- Table fit measured in the browser at 1440 px and 1366 px in both row densities: it fits with no clipping and the Details button is visible. Found and fixed: it overflowed at 1366 px; pay text wrapped; an inline company line made compact rows uneven.
- Compact setting saved and applied before first paint; verified it persists and the button reports its state (aria-pressed).

Not performed (accessibility)
- A manual screen-reader pass (NVDA, JAWS or VoiceOver) and a full keyboard walk of every screen. Automated tools catch roughly a third to a half of accessibility problems, so this is not a compliance certification.
- Tablet and real-device testing, browser zoom to 400 percent, Windows high-contrast mode, and the Pay and Job type filters with real data (existing listings have none until the next check).

Not performed (design)
- Keyboard-only and screen-reader pass of the new table and Market view, an automated accessibility scan, light mode (the app is dark only), and real-device testing.

Not performed (accounts)
- A real Resend email send (no key configured), so delivery of verification, reset and notice emails is unverified; in tests the links were created directly.
- Scanning the QR code with a real authenticator app (the code logic is tested against RFC vectors and the QR image is generated, but no phone was used).
- Screen-reader and keyboard-only pass, real-device test, external penetration test.

Not performed
- Greenhouse, Lever and Resend email calls (no keys or feeds configured). The Adzuna check was run by the user, not by the test suite.
- Automated accessibility scan, manual screen-reader pass, real-device testing, load/abuse testing.
- Uploading the real resume through the Settings page in the browser (the parser was run on it from a script, and the upload route was tested with a generated PDF).

Import round (2026-11-06)
- 392 automated tests across 10 files pass, including importer fuzzing (hostile CSV, huge/garbage input), route abuse, concurrent writes, corrupt-file recovery and 3,000-opening performance.
- Browser walkthrough on a throwaway copy of the data: hostile CSV upload, column mapping, preview, commit, Applied tab, pasted list, axe scan of the Import page in light and dark (0 violations).
- Not done: screen-reader pass, phone-width visual pass of Import, real-device testing.
