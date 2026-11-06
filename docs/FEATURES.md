# Features

A walkthrough of what Vantage does. For the overview, see the [README](../README.md).

## Filters (like Indeed)
Under the tabs there is a search box and a row of chips: **Date posted**, **Pay**, **Job type**, **Experience level**, **Work setting** (Remote, Hybrid, On-site), **Company**, **Job category**, **Match** and **Sort by**. Pick an option and the list updates; an active chip is highlighted; **Clear all** resets. Options show how many openings they would give.
- Pay and Job type come from the source (Adzuna), and only when a posting states them. Openings that do not list pay drop out when you filter by pay, like Indeed. Older saved openings get this data the next time a check sees them again.
- Experience level is worked out from the title, the wording and any years the posting asks for. Openings that give no signal are not shown under any level.
- Distance is the radius in the search bar above.

## Appearance and accessibility
Two looks: **Light** is a clean ledger style and **Dark** is brand-forward with the green-to-blue gradient. The **Compact** button in the sidebar tightens the table to fit more openings on screen (desktop only). Use the **Auto / Light / Dark** button (bottom of the sidebar, top right on sign-in screens). Auto follows your device. Colors meet WCAG 2.2 AA contrast, everything works with a keyboard (filter menus open with Enter and close with Escape), and the chart uses patterns as well as color. See [TESTING.md](TESTING.md) for what was and was not checked.

## Seeing and controlling what is pulled
- **What's being searched** (dashboard, under Check now): the job titles sent to the search, the area, which sources are on, which job types are kept, and what is never kept.
- **Search terms:** edit them on Settings (up to 12). Each term is searched near you and for remote work, so every term costs about 2 search requests per check; on a free Adzuna test key, fewer terms go further.
- **Filters:** narrow what you see by job type (SOC / Security Analyst, GRC / Compliance, Security Engineer, Vulnerability / Pen Test, Incident Response / Threat, Other), remote or near you, fit level, or a title/company search. Filters only change what is shown, not what is fetched or saved.
- A listing is only saved if its title looks like one of those job types, so a search term that finds unrelated roles will not fill your list with them.

## Info button
Every job card has an **Info** button. It explains the score in plain bullets: a bottom-line verdict, why it fits, which skills from your resume appear in the posting (with your resume line and the posting's wording side by side), degree and cert notes, watch-outs, and what the posting text does not confirm. It only uses rules and the facts in the posting, so it never claims more than the text shows.

## Importing applications you made elsewhere
Open Import in the sidebar. Upload a CSV or spreadsheet export, paste a list (one job per line, such as "SOC Analyst - Acme - Akron, OH - 11/2/2026"), or add one by hand. Check the preview, then import. Imported jobs are marked Applied and are not scored. Re-importing the same file changes nothing. Nothing is sent anywhere; the file is read in your browser.

## Matching limits
Adzuna returns truncated descriptions, so years/cert detection there is best-effort; Greenhouse/Lever feeds include full text. Treat the flags as a triage aid, not a verdict, and always read the posting.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](../SECURITY.md), [PRIVACY.md](PRIVACY.md) and [TESTING.md](TESTING.md).
