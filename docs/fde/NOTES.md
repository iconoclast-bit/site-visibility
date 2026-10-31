# Handover notes (v1.1, deploy-ready)

## Problem and the structural gain
Today every client question ("what's happening / when / why late?") is answered by hand, often after driving to site; delays are discovered when the client complains. Target: **the unit of work changes from "owner answers each client" to "supervisor does one 3-minute check-in; owner reviews exceptions; client self-serves."**
Baseline to capture before a pilot (not yet measured): minutes/day the owner spends answering status questions; number of client "where are we" messages per project per week; days between a delay starting and the owner noticing. Pilot target to agree with the owner, for example: status messages answered by hand down by half; delay noticed within 2 days.

## v1.1: what changed since the demo build
- **Deployable**: `PgStore` (any Postgres via `DATABASE_URL`), schema auto-created, passes the same contract tests as the JSON store. `docs/DEPLOY.md` has the Vercel + Neon steps. Demo is off by default whenever a database is configured; a real deployment needs a strong `OWNER_TOKEN`. `/api/health` for uptime checks.
- **Run the studio without editing JSON**: owner creates projects and supervisors in the browser, edits settings, manages the AMC and logs service visits.
- **Inspiration feed on the client page**: progress photos from the studio's other sites, so a client can see a look and ask for something similar ("I'd like something like this" goes to the owner as a design lead with the photo and a WhatsApp reply link). Consent-gated per project, owner picks the photos, no names/addresses, newest first, at most 5 posts per site, six shown at a time.
- **Finished homes gallery** (same section, above work in progress): other clients' completed homes, final-stage photos first, with an AMC tag ("Has an AMC · Gold AMC · Active" or "No AMC") and a count of how many clients asked for a similar design. Same consent and owner-selection gates; the AMC tag is covered by the showcase consent wording.
- **AMC card on the client page** (only when bought): status (starts after handover / active / expiring soon / expired), validity and days left, visits used of included, next visit due, coverage, visit history, renew-on-WhatsApp when expiring or expired.
- Photo upload budget so a check-in always fits a 4.5 MB request limit.

## What is done
- Three role views + demo hub (all responsive, tested at 320 / 390 / 768 / 1280 px).
- Deterministic schedule engine (`lib/schedule.ts`): plan, replay, forecast, slip, flags, health, next-up, plain-language reasons.
- Supervisor check-in: per-stage state, percent chips, required blocked reason, per-stage photos (client-side 1600px JPEG re-encode), note, silent location, sticky send bar that lists exactly what is sent, offline-safe outbox with idempotent retry.
- Owner: KPIs, urgency-sorted cards, approval queue (editable drafted message, reset, optional AI rewrite), published feed, planned-vs-expected timeline with Today marker, share box (copy, wa.me).
- Client: read-only hero with honest "N days behind", plain-word on-hold reasons, happening now / up next / timeline / updates with photo viewer. Built only from approved check-ins in one function (`buildClientView`).
- JSON-file `Store` behind an interface (atomic rename, serialised read-modify-write).

## Decisions worth knowing (small deviations from the brief are marked *)
- **Showing one client's home to other clients needs consent.** Default is off. The owner must tick consent per project and choose the photos; the client's own permission is a conversation you have, not something the app can verify. The checkbox wording says so. Revoking consent removes the photos from the feed at once.
- Feed posts are labelled only "3BHK · Modern minimal". Captions are owner-written; supervisor notes are never shown.
- **AMC "at handover" is pinned to the first time the project was completed.** Reopening a stage later (a snag) does not move the AMC dates.
- AMC visits are logged by the owner (the client sees the note), not by the supervisor app. Due dates are spread evenly across the term.
- Photos are stored in Postgres (bytea), not object storage, to keep deployment to one service.
- Dashboard ranks finished projects below every active one.
- Owner numbers include pending check-ins (the true state, and exactly what the draft is computed from); client numbers use approved only. The owner page says so when pending updates exist.
- *Forecast for a not-started stage is also never earlier than **today** (the brief says "after dependencies and never earlier than planned start"). A stage that has not started cannot start in the past; without this a stalled project looked on time.
- Health: Needs attention = any blocked stage or heading >= 4 days late; Watch = 1-3 days late, a ready stage that did not start, or no update for 2+ days; else On track.
- Should-have-started = not started, all dependencies done, planned start strictly before today.
- Reopening a done stage without a percent assumes 90%.
- Updates sent = stages the supervisor changed + everything still working/blocked (the daily "still blocked" confirmation).
- Queued offline check-ins keep their original time if delivered within 72 h; the IST date follows that time.
- Server also strips EXIF/XMP/text chunks from JPEG, PNG and WebP uploads (second line of defence behind the canvas re-encode).
- `proxy.ts` exists only so bad links get a real HTTP 404 (streamed pages would answer 200).

## Verified (all in `npm run verify`)
- v1.1 additions: 181 unit tests in total (new: AMC status and visit schedule, feed privacy and consent rules, owner admin validation and routes, interest button, feed photo route, photo budget, bootstrap safety, a dual-store contract run against JSON and real Postgres). The E2E now runs the whole flow against BOTH the JSON store and Postgres (PGlite over TCP with the production `pg` driver): 49 steps, including owner project creation in the browser, feed consent lifecycle, interest reaching the owner, AMC states with renewal, and a request-size check with six large photos.
- Earlier 105 unit tests: plan/dependencies/cycles, replay and reopen, forecast and slip, every flag, % / next-up / health, validation incl. bad inputs, template wording, AI guard (dates, links, length, day counts), AI fallback with mocked HTTP, photo sniffing and metadata stripping, API auth/idempotency/double-publish/concurrency, client-view privacy, seed SVG validity.
- 20-step Playwright E2E on the production build: supervisor phone flow (photo stored pending, JPEG with no EXIF/GPS and <= 1600 px, location kept) -> client cannot see it or its photo -> owner on desktop sees both pending cards, edits, publishes both -> client on phone sees both, photo viewer opens/closes -> client HTML and RSC payload leak nothing -> wrong/foreign/cross-role tokens rejected (404 pages, 401/403 APIs) -> double publish 409 -> AI route 501 without key -> simulated old Android WebView (no `createImageBitmap`, geolocation, clipboard, `toBlob`) -> offline send, reload, recover with no duplicate -> every view at 4 widths: no horizontal scroll, no broken images, tap targets >= 44 px on the form, no console/page errors, no 5xx. Screenshots were reviewed by eye (they caught an invalid demo SVG, now covered by a unit test).

## Known gaps (priority order)
0. **Not deployed by me.** `docs/DEPLOY.md` is tested only as far as a local production build against Postgres. A first real deploy may surface host-specific settings (env vars, region, connection pooling). Check `/api/health` first.
1. **Not tested on real devices** (a real cheap Android + the real app WebView, on real 4G). The simulation covers missing APIs, not performance or vendor quirks.
2. **Live AI call never run** (no API key here). The request shape, guard and fallbacks are tested with mocked HTTP only. Try one real rewrite and read the text.
3. **Auth is pilot-grade** (secret links, no expiry/rotation/audit, plain token comparison, no rate limiting). No in-app way to rotate a leaked link (SQL in DEPLOY.md). Fine for one trusted pilot; replace before scale.
4. **JSON-file store is dev/demo only**; deploy with Postgres. Photos in Postgres are fine for a pilot; move to object storage when the database grows.
5. Owners cannot yet edit a project's stages or dates, or delete/archive a project, from the UI. Supervisor reassignment is also not in the UI.
5a. **Reopening a stage on a finished project** (a snag fix by the supervisor) shows the project as "late" (the forecast is deterministic). Use AMC visits for post-handover work, or archive finished projects from the supervisor list (not built).
5b. Feed is read-only: no comments or posting between clients (a real forum needs identity and moderation). No per-client "not interested" or hiding, no pagination beyond 20 posts, interests have no status (new / contacted). Photo content is checked by the owner by eye, not automatically (faces, nameplates).
5c. AMC: no payments, no reminders to the client or owner before a visit is due or the AMC expires (the card shows it only when the client opens the page).
6. **No notification** when a check-in arrives or a project turns late (owner must open the dashboard). WhatsApp is manual (wa.me).
7. Stage template and durations are placeholders; per-project stage editing is not exposed.
8. One supervisor token covers all projects assigned to it; no per-project supervisors in the UI.
9. Client messages are English; the supervisor can dictate Hinglish notes (kept internal) but there is no Hindi UI.
10. WebP metadata stripping is unit-tested on synthetic files only; clients always send JPEG so it is a backstop.
11. Time zone is fixed to IST.

## Open questions for the owner (Aarav)
- Real stages, durations, and which stages can run in parallel (carpentry vs false ceiling is a guess). Do projects vary by BHK size?
- How many supervisors, and does one cover several sites? Who is the pilot supervisor?
- Which 1-2 projects will the pilot run on, and for how long (suggest 2-3 weeks)?
- How should the client be told the link exists (WhatsApp group message vs direct)? Should the architect/carpenter ever see it?
- What counts as "late" to you (our default: any forecast slip; "needs attention" at 4+ days)?
- Do you want to approve every update, or auto-publish routine "no change" ones after a few weeks of trust?
- Is the client allowed to see photos of work in progress that looks messy? Any photos that must never be published?
- Inspiration feed: how do you get each client's consent today (WhatsApp message, clause in the contract)? Should consent be the default for new projects? Should the feed also include the studio's finished showcase homes that are not tracked projects?
- AMC: standard plans, terms, prices and what each covers? Do visits need a supervisor sign-off and photos? Should expiring AMCs trigger a message from you automatically?
- Who is "Design by Aarav" on WhatsApp for client enquiries (the number to put in `STUDIO_PHONE`)?

## Out of scope (later)
Trade task assignment, bill OCR, stage checklists, change-request log, design-articles feed, a public marketing gallery of showcase homes, WhatsApp Business API (automatic messages), Hindi UI, real auth (per-user sign-in), object storage for photos, AMC payments and automatic reminders.
