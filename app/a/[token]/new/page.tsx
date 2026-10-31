import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewProjectForm } from "@/components/NewProjectForm";
import { Loading, TopBar } from "@/components/ui";
import { resolveToken } from "@/lib/auth";
import { todayIST } from "@/lib/dates";
import { getStore } from "@/lib/store";

export const metadata = { title: "New project" };

export default function Page({ params }: PageProps<"/a/[token]/new">) {
  return (
    <Suspense fallback={<Loading />}>
      <NewProject params={params} />
    </Suspense>
  );
}

async function NewProject({ params }: Pick<PageProps<"/a/[token]/new">, "params">) {
  const { token } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "owner") notFound();
  const [studio, supervisors] = await Promise.all([store.getStudio(), store.listSupervisors()]);
  return (
    <main className="wrap stack">
      <TopBar title={studio.name} role="Owner" />
      <div>
        <Link href={`/a/${token}`} className="backlink">← All projects</Link>
        <h1>New project</h1>
        <p className="muted">Uses the standard seven stages (civil to handover). You get a client link and, if you add a supervisor, their link.</p>
      </div>
      <NewProjectForm token={token} supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))} today={todayIST()} />
    </main>
  );
}
