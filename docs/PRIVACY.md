# Privacy and data

- **Collected:** public job listings (title, company, location, description snippet, URL) and your own status marks (new/seen/saved/applied/dismissed).
- **Resume (optional):** uploaded on the Settings page and parsed locally with an internal rule-based engine (no AI, nothing sent out). The file is not kept. Saved in `data/settings.json` (git-ignored): education lines, your experience and project entries (headings, dates, bullet text), certifications/training lines, and the skills and tools found. Emails, phone numbers and web addresses are removed and your name is not stored. "Remove resume data" deletes all of it; uploading a new resume replaces it.
- **Search terms:** the job titles you choose are saved in `data/settings.json` and sent to Adzuna as search words.
- **Location:** the ZIP or City, ST you type is saved as your default in `data/settings.json` and sent to Adzuna as the search area. The browser's location feature is not used.
- **Account:** your email address, a salted password hash (never the password), whether the email is verified, and, if you turn on 2FA, an encrypted authenticator secret and hashed recovery codes. Stored in `data/auth.db` (git-ignored).
- **Sessions and security log:** each signed-in session records its IP address, browser/device string and times, so you can see and revoke devices. The activity log (last 1,000 events) records sign-ins, failures and account changes with IP and device. Neither contains passwords, codes or tokens. Expired sessions are deleted automatically.
- **Email:** verification, reset and notice emails are sent through Resend, which receives your email address and the message.
- **Imported applications:** title, company, place, link, date applied and notes you provide are saved in `data/store.json`. Files are read in the browser and only the rows are sent to this app.
- **Not collected:** credentials for job sites, and anything about you beyond the settings above.
- **Stored:** locally in `data/store.json` (git-ignored). Run history keeps the last 50 runs. Delete the file to erase everything.
- **Third parties:** Adzuna (receives your search terms and location), Greenhouse/Lever (public feeds for employers you list), Resend (receives the digest content and your email address, only if configured).
- **No analytics, no AI/ML processing, no cookies other than the login session.**
- Data is externally sourced and unverified; match reasons and gaps are rule-based estimates.
