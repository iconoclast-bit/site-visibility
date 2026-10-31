# Site Visibility

One 3-minute daily check-in from a site supervisor becomes a client-ready update. The studio owner reviews and publishes in one tap; the client reads status themselves. Clients also get an **inspiration feed** of progress photos from the studio's other sites (with the owners' consent, anonymised) and, if they bought one, their **AMC status**. Built for "Design by Aarav".

## Run it locally (3 commands)
```bash
npm install
npm run build
npm start          # http://localhost:3000  (demo hub with seeded data, JSON-file store)
```
Dev mode: `npm run dev`. Full check: `npm run verify`.

## Deploy it
See **[docs/DEPLOY.md](docs/DEPLOY.md)**: one Postgres database (`DATABASE_URL`) and one `OWNER_TOKEN`, on Vercel or any Node host. Config reference: `.env.example`.

## Try the demo
Open `/`, or use the demo links directly:
| Role | URL |
|---|---|
| Supervisor (phone-first) | `/s/demo-supervisor` |
| Owner | `/a/demo-owner` |
| Clients | `/c/demo-client-sharma`, `/c/demo-client-mehta`, `/c/demo-client-verma`, `/c/demo-client-kapoor` |

Story: Sharma is late with a blocked ceiling and an update waiting; Mehta is slightly behind and bought an AMC that starts at handover; Verma is on track; Kapoor is finished with an active AMC (1 of 4 visits done). Mehta's client page shows the inspiration feed built from the other three homes.

## Before real use
- **The demo is for local use only.** It uses public links. With `DATABASE_URL` set it is off automatically.
- **Auth is pilot-grade**: whoever holds a link has that role. See `docs/fde/NOTES.md` for the gaps and open questions.
