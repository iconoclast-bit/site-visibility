import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CheckinForm, type FormStage } from "@/components/CheckinForm";
import { Loading } from "@/components/ui";
import { resolveToken } from "@/lib/auth";
import { fmtDate, todayIST } from "@/lib/dates";
import { computeSchedule } from "@/lib/schedule";
import { getStore } from "@/lib/store";

export const metadata = { title: "Daily check-in" };

export default function Page({ params }: PageProps<"/s/[token]/[projectId]">) {
  return (
    <Suspense fallback={<Loading />}>
      <Checkin params={params} />
    </Suspense>
  );
}

async function Checkin({ params }: Pick<PageProps<"/s/[token]/[projectId]">, "params">) {
  const { token, projectId } = await params;
  await connection();
  const store = getStore();
  const who = await resolveToken(store, token);
  if (who?.role !== "supervisor" || !who.supervisor.projectIds.includes(projectId)) notFound();
  const project = await store.getProject(projectId);
  if (!project) notFound();
  const today = todayIST();
  const checkins = await store.listCheckins(projectId);
  const s = computeSchedule(project, checkins, today); // the supervisor sees the true current state, pending included
  const stages: FormStage[] = project.stages.map((st) => ({
    id: st.id,
    name: st.name,
    state: s.status[st.id].state,
    percent: s.status[st.id].percent,
    blockedReason: s.status[st.id].blockedReason,
  }));
  return <CheckinForm token={token} projectId={project.id} projectName={project.name} dateLabel={fmtDate(today)} stages={stages} sentToday={checkins.some((c) => c.date === today)} />;
}
