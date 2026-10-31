# Deploying Site Visibility

Everything needed to run it for real: one Postgres database and one Node host. These steps use Vercel + Neon, but any Node host and any Postgres work the same way (the app only needs `DATABASE_URL`).

## 1. Create the database
- **Vercel + Neon (simplest):** in the Vercel dashboard, Storage -> Create -> Neon (Postgres). Link it to the project. It adds `DATABASE_URL` for you.
- **Supabase / RDS / anything else:** create a Postgres database and copy its **pooled** connection string.

The app creates its own tables on first request (safe to run concurrently; it takes a lock). Nothing to migrate by hand.

### Supabase specifics
- Use the **transaction pooler** string (Connect -> Transaction pooler, port 6543, host `...pooler.supabase.com`). Vercel is IPv4-only and the direct `db.<ref>.supabase.co` host is IPv6-only, so the direct string will not connect.
- If the TLS handshake is rejected (`self-signed certificate in certificate chain`), append `?sslmode=no-verify` to the URL (or `&sslmode=no-verify` if it already has `?`).
- Supabase exposes the `public` schema through its Data API. The app's tables hold link tokens and photos, so **do not create them in `public`**. Create a private schema and a least-privilege role instead, and point the role's `search_path` at it:
```sql
create schema sv;
create role sv_app login password '<strong password>' nosuperuser nocreatedb nocreaterole;
grant usage, create on schema sv to sv_app;
alter role sv_app set search_path = sv;
```
  Then connect as `sv_app.<project-ref>` through the pooler. Nothing in `sv` is reachable through the Data API.
- The Supabase integration for Vercel sets `POSTGRES_URL`; the app accepts it in place of `DATABASE_URL`.
- Run the function in the same region as the database: `vercel.json` pins `bom1` (Mumbai) to match a `ap-south-1` project.

## 2. Create the Vercel project
1. Push this folder to a Git repository and import it in Vercel (Framework: Next.js is detected; Node 20+; nothing to change in build settings). Or run `npx vercel` in this folder.
2. Add environment variables (Settings -> Environment Variables), for Production:

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | pooled Postgres URL |
| `OWNER_TOKEN` | yes | a long secret: `openssl rand -base64 24 \| tr '+/' '-_' \| tr -d '='` |
| `STUDIO_NAME` | no | e.g. `Design by Aarav` (read once, on first run) |
| `STUDIO_PHONE` | no | WhatsApp number, digits with country code (read once, on first run) |
| `PG_POOL_MAX` | recommended | `1` |
| `ANTHROPIC_API_KEY` | no | turns on "Rewrite with AI" |

**Do not set `DEMO_HUB`.** With `DATABASE_URL` set the demo is off and the app refuses to start without a strong `OWNER_TOKEN`. (The demo uses public, guessable links; it must never run in production.)

3. Deploy.

### Deploying with the Vercel CLI (no GitHub needed)
If the Vercel project already exists with its environment variables (as in the Supabase setup above), deploy from this folder:
```bash
npm i -g vercel            # or use npx vercel@latest
vercel login
vercel link --project site-visibility --scope <your-vercel-scope> --yes
vercel deploy --prod
```
`.gitignore` keeps `node_modules`, `.next` and `.data` out of the upload. Later, connect the GitHub repo under Project -> Settings -> Git for push-to-deploy (this needs the Vercel GitHub app to have access to the repo).

## 3. Check it
- `https://<your-domain>/api/health` returns `{"ok":true}`.
- `https://<your-domain>/` is a 404 (the demo hub is off).
- Open **`https://<your-domain>/a/<OWNER_TOKEN>`**. That is your owner link: bookmark it and keep it private. The dashboard is empty.

## 4. First-run checklist (about 10 minutes)
1. **New project**: name, client, address, home type and style, start date, and a supervisor (the form creates one and shows their link). The form shows the **client link** and the **supervisor link**: copy both.
2. Send the supervisor their link (WhatsApp). On a phone they add it to the home screen. They do the daily 3-minute check-in.
3. Review the first update in the approval queue and publish. Send the client their link with the **Send on WhatsApp** button on the project page.
4. If the client bought an AMC: project page -> AMC -> Add AMC. It appears on the client's page; log service visits as they happen.
5. For the inspiration feed: only with the client's permission, tick the consent box in the project's Settings (or on the New project form). Then tick the photos you want to share when you approve an update, or later under "Published updates". Other clients see them with no name or address.

## 5. Operating notes
- **Links are the passwords.** Anyone with a link has that role. Use HTTPS only (Vercel does). If a link leaks, there is no in-app rotation yet: for the owner token change `OWNER_TOKEN` in the database (`UPDATE studio SET data = jsonb_set(data, '{ownerToken}', '"NEW_TOKEN"') WHERE id = 1;`); for a client or supervisor, ask for a rotate feature or update the row.
- **Upload limit:** hosts like Vercel reject request bodies over 4.5 MB. The supervisor app already shrinks photos to fit (about 3.4 MB total per check-in), so no action is needed.
- **Photos live in Postgres** (about 0.3-0.5 MB each). Fine for a pilot and a few dozen projects. Move them to object storage (S3, Vercel Blob, Supabase Storage) when the database grows past a few GB. The seam is `lib/store/types.ts`.
- **Backups:** use your database provider's (Neon/Supabase point-in-time restore).
- **No rate limiting yet.** Tokens are 144-bit random, so guessing is not practical, but put a WAF or Vercel Firewall rule in front if the URL becomes public knowledge.
- `STUDIO_NAME` and `STUDIO_PHONE` are stored on first run; change them later with `UPDATE studio SET data = data || '{"phone":"91..."}'::jsonb WHERE id = 1;`.

## 6. Any other Node host (Render, Railway, a VPS)
```bash
npm ci && npm run build
DATABASE_URL=... OWNER_TOKEN=... npm start     # listens on $PORT (default 3000)
```
Put it behind HTTPS. A persistent disk is **not** needed when `DATABASE_URL` is set.

## 7. Verify a build before shipping
`npm run verify` runs typecheck, lint, 180 unit tests, a production build, and the end-to-end suite against **both** the JSON store and a real Postgres (in-process, over TCP with the same `pg` driver production uses).
