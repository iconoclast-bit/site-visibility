# Site Visibility

Daily site check-in (supervisor) -> owner approves -> client reads. Next.js 16 App Router + TypeScript, no CSS framework.

@AGENTS.md  <!-- Next 16 differs from older versions: read node_modules/next/dist/docs/ before changing routing/caching -->

## Commands
- `npm run dev` / `npm run build && npm start` (port 3000). Demo hub at `/` (local JSON store only).
- `npm run verify` = typecheck + lint + unit tests + production build + E2E. Must be green before handover.
- `npm test` (vitest, `tests/unit`), `npm run e2e` (Playwright vs the production build, run against BOTH stores; needs `npm run build` first; `E2E_BACKENDS=json` or `pg` runs one).
- `npm run reseed` deletes `.data/`; demo data regenerates (relative to today) on the next request.
- Deploy: `docs/DEPLOY.md`. Config: `.env.example`.

## Map
- `lib/schedule.ts` **all dates, lateness, dependencies, ETAs, flags, health.** `lib/dates.ts` UTC date math, IST "today".
- `lib/draft.ts` template client message + `guardAiDraft`. `lib/ai.ts` the ONE optional LLM call (Messages API, `fetch`).
- `lib/validation.ts` + `lib/photos.ts` server-side input checks, image sniffing, EXIF stripping.
- `lib/clientView.ts` **the client privacy boundary** (approved check-ins only, no internal fields). `lib/feed.ts` the inspiration feed (consent-gated, anonymised). `lib/amc.ts` AMC status (deterministic dates).
- `lib/store/` `Store` interface + `JsonStore` (local dev/demo) + `PgStore` (any Postgres via `DATABASE_URL`; deploy this). Both must pass `tests/unit/store.contract.test.ts`. `lib/bootstrap.ts` first-run data + the safe demo switch. `lib/seed.ts` demo data. `lib/auth.ts` token -> role.
- `lib/adminValidation.ts` owner-managed data (projects, supervisors, AMC, feed selection).
- `app/api/*` checkins, approve, drafts, photos, feed (opaque photo handles), interests, projects (+amc, +visits), supervisors, health. `app/{s,a,c}/[token]/...` supervisor, owner, client pages. `proxy.ts` real 404s for bad links.
- `components/` UI. Client-side only: `CheckinForm`, `lib/imageCompress.ts`, `lib/outbox.ts` (IndexedDB, offline-safe).

## Rules (do not break)
1. Dates, "is it late", dependencies, ETAs come from `schedule.ts` only. Client text may repeat only dates the schedule computed. The AI draft must pass `guardAiDraft` (no invented dates, links, empty text, >110 words) else fall back to the template.
2. Nothing reaches a client without owner approval. Client numbers come from approved check-ins only. Photos of unapproved check-ins return 404 to the client token.
3. Client-visible data never contains: address/locality, GPS, supervisor name or notes, raw internal reasons (use `plainReason`), tokens of other roles. Build client data only in `buildClientView`; pass that object, never `Project`/`Checkin`, to client-facing UI.
4. Pages are `noindex` (meta, `X-Robots-Tag`, robots.txt). Tokens are secrets in links: pilot-grade auth, replace before scale.
5. Exactly one LLM call (rewrite the client message), model `claude-haiku-5-5` (override `ANTHROPIC_MODEL`). Fully usable with no key. No agent framework.
6. Never accept SVG uploads (only seed demo photos are SVG). Server re-strips metadata even though the browser re-encodes.
7. **Inspiration feed privacy.** A photo reaches another client only if ALL hold: its project has `showcase` consent, its check-in is published, the owner selected that photo, and it is not the viewer's own site. Posts carry only home type + style, stage, date, owner caption. Photos are served by opaque handle (`/api/feed/<id>`), never by project id or file name. Consent withdrawal takes effect immediately. Do not add fields to `FeedPost` without re-running the leak tests.
8. **AMC dates are deterministic** (`lib/amc.ts`) and an AMC "at handover" is anchored to the FIRST completion date (`completionDate`), so reopening a stage never rewrites a contract.
9. **Demo is never on in production**: `demoEnabled()` is off whenever `DATABASE_URL` is set unless `DEMO_HUB=on`; a real deployment refuses to start without a strong `OWNER_TOKEN`. New tokens come from `newToken()` (144-bit).

## Next 16 / Cache Components gotchas
- `cacheComponents` is on: request-time data (params, env, fs) is read inside `<Suspense>` after `await connection()`. `params` is a Promise.
- Route segment config `runtime` / `dynamicParams` is a build error here. Don't add them.
- Store is a `globalThis` singleton shared by route bundles: check store errors with `errorCode(e)`, never `instanceof` (this caused a real 500 in production builds).
- Streamed page content is swapped in after `load`: in Playwright wait for elements (`locator.waitFor`), do not use `isVisible` right after navigation.
- Hosts cap request bodies (Vercel 4.5 MB): the check-in form shrinks photos to a ~3.4 MB budget (`fitToBudget`). Keep new upload fields small.
- Streamed pages answer 200 even if `notFound()` fires inside Suspense, so `proxy.ts` returns the real 404 for bad/wrong-role tokens.

## WebView / old-browser rules (supervisor runs inside Android/iOS WebViews)
- No `aspect-ratio`, `inset`, `:has()`, and no flex `gap` (use margins; grid `gap` is fine). `min-height: 100vh` before `100dvh`. `viewport-fit=cover` + `env(safe-area-inset-*)`.
- Feature-check `createImageBitmap`, `canvas.toBlob`, `navigator.geolocation`, `navigator.clipboard` (fallbacks: `<img>` decode, `toDataURL`, skip location, `execCommand`). E2E simulates all four missing.
- Tap targets >= 44px (E2E asserts this on the check-in form). Never lose a send: `lib/outbox.ts` saves before the first attempt; the check-in id makes retries idempotent.
