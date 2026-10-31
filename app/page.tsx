import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Loading, TopBar } from "@/components/ui";
import { DEMO_TOKENS } from "@/lib/seed";
import { demoHubEnabled, getStore } from "@/lib/store";

export default function Home() {
  return (
    <Suspense fallback={<Loading />}>
      <Hub />
    </Suspense>
  );
}

async function Hub() {
  await connection(); // reads env + data at request time
  if (!demoHubEnabled()) notFound();
  const store = getStore();
  const [studio, projects] = await Promise.all([store.getStudio(), store.listProjects()]);
  return (
    <main className="wrap stack">
      <TopBar title="Site Visibility" role="Demo hub" />
      <div>
        <h1>See the three views</h1>
        <p className="muted">One 3-minute check-in from the site supervisor becomes a client-ready update. The owner reviews and publishes in one tap; the client reads it themselves.</p>
      </div>
      <div className="hubgrid">
        <Link className="card link" href={`/s/${DEMO_TOKENS.supervisor}`} data-testid="hub-supervisor">
          <span className="badge info">1 · On site</span>
          <h2 style={{ marginTop: 8 }}>Site supervisor</h2>
          <p className="muted small">Phone-first. Tap each stage, add photos, send. Takes about 3 minutes.</p>
        </Link>
        <Link className="card link" href={`/a/${studio.ownerToken}`} data-testid="hub-owner">
          <span className="badge warn">2 · Studio owner</span>
          <h2 style={{ marginTop: 8 }}>Dashboard &amp; approvals</h2>
          <p className="muted small">All projects by urgency. Review the drafted message and publish in one tap.</p>
        </Link>
        <div className="card">
          <span className="badge ok">3 · Client</span>
          <h2 style={{ marginTop: 8 }}>Client view</h2>
          <p className="muted small">Read-only, mobile-first. Shows approved updates only.</p>
          <ul className="stack-sm" style={{ paddingLeft: 18, margin: "8px 0 0" }}>
            {projects.map((p) => (
              <li key={p.id}><Link href={`/c/${p.clientToken}`} data-testid={`hub-client-${p.slug}`}>{p.name}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      <p className="note">Demo data is generated relative to today. This hub exposes every link on purpose; switch it off with <code>DEMO_HUB=off</code> for real use.</p>
    </main>
  );
}
