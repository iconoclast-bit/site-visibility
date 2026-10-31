import { describe, expect, it } from "vitest";
import { allowedDates, allowedDayCounts, guardAiDraft, slipPhrase, stateAfter, templateDraft } from "@/lib/draft";
import { rewriteDraft } from "@/lib/ai";
import { computeSchedule } from "@/lib/schedule";
import { fmtDate } from "@/lib/dates";
import { blocked, ck, done, project, w } from "./helpers";

const p = project();
const history = [ck("2026-03-08", [done("civil")]), ck("2026-03-14", [done("elec")])];

describe("template draft", () => {
  it("lists changes, next up and expected handover with the computed slip", () => {
    const today = "2026-03-20";
    const c = ck("2026-03-20", [w("carpentry", 5), blocked("ceiling", "Material not arrived", 30)], { review: "pending" });
    const text = templateDraft({ project: p, checkin: c, allCheckins: [...history, c], today });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Hi Priya,");
    expect(lines[1]).toBe("Today at site:");
    expect(text).toContain("• Carpentry started (5% done)");
    expect(text).toContain("• False ceiling is on hold: waiting for material to be delivered");
    expect(text).not.toContain("Material not arrived"); // raw reason never leaks into client text
    expect(text).toContain("Next up: Putty & paint (once False ceiling and Carpentry are done)");
    const sched = computeSchedule(p, [...history, c], today);
    expect(sched.slipDays).toBe(5);
    expect(lines[lines.length - 1]).toBe(`Expected handover: ${fmtDate(sched.forecastEnd)} (5 days later than planned)`);
  });

  it("drafts against approved + pending up to and including this check-in (not later ones)", () => {
    const pendingA = ck("2026-03-18", [w("carpentry", 20)], { review: "pending", createdAt: "2026-03-18T09:00:00Z" });
    const pendingB = ck("2026-03-19", [w("carpentry", 60)], { review: "pending", createdAt: "2026-03-19T09:00:00Z" });
    const all = [...history, pendingA, pendingB];
    const { before, schedule } = stateAfter({ project: p, checkin: pendingA, allCheckins: all, today: "2026-03-20" });
    expect(before.carpentry.state).toBe("not_started");
    expect(schedule.status.carpentry.percent).toBe(20); // B is ignored when drafting A
    const text = templateDraft({ project: p, checkin: pendingA, allCheckins: all, today: "2026-03-20" });
    expect(text).toContain("On Wed 18 Mar at site:");
  });

  it("describes unchanged, resumed and reopened stages sensibly", () => {
    const base = [...history, ck("2026-03-16", [w("carpentry", 40), blocked("ceiling", "Material not arrived", 30)])];
    const c = ck("2026-03-17", [w("carpentry", 40), w("ceiling", 35), done("civil"), { stageId: "paint", state: "not_started" }]);
    const text = templateDraft({ project: p, checkin: c, allCheckins: [...base, c], today: "2026-03-17" });
    expect(text).toContain("Carpentry continues (40% done)");
    expect(text).toContain("False ceiling is back in progress (35% done)");
    expect(text).not.toContain("Civil & demolition completed"); // was already done
    expect(text).not.toContain("Putty & paint moved back"); // was never started
  });

  it("says so when nothing changed, and when the project is complete", () => {
    const c = ck("2026-03-20", []);
    expect(templateDraft({ project: p, checkin: c, allCheckins: [...history, c], today: "2026-03-20" })).toContain("no change in progress to report");
    const finish = ck("2026-04-30", p.stages.map((s) => done(s.id)));
    const t = templateDraft({ project: p, checkin: finish, allCheckins: [finish], today: "2026-04-30" });
    expect(t).toContain("All stages are complete.");
    expect(t).not.toContain("Expected handover");
  });

  it("slip wording", () => {
    expect(slipPhrase(1)).toBe("1 day later than planned");
    expect(slipPhrase(5)).toBe("5 days later than planned");
    expect(slipPhrase(-2)).toBe("2 days ahead of plan");
    expect(slipPhrase(0)).toBe("on schedule");
  });
});

describe("AI guard", () => {
  const c = ck("2026-03-20", [w("carpentry", 40)]);
  const sched = computeSchedule(p, [...history, c], "2026-03-20");
  const opts = { allowedDates: allowedDates(p, sched), allowedDayCounts: allowedDayCounts(sched) };
  const goodDate = "20 Mar";
  const handover = new Date(sched.forecastEnd + "T00:00:00Z");
  const handoverText = `${handover.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][handover.getUTCMonth()]}`;

  it("accepts a clean message that repeats computed dates and counts", () => {
    const r = guardAiDraft(`Hi Priya, carpentry is 40% done. Expected handover is ${handoverText}, ${sched.slipDays} days later than planned. Started ${goodDate}.`, opts);
    expect(r.ok).toBe(true);
  });
  it("rejects empty text", () => {
    expect(guardAiDraft("   ", opts)).toMatchObject({ ok: false });
  });
  it("rejects more than 110 words", () => {
    const long = Array.from({ length: 111 }, () => "word").join(" ");
    expect(guardAiDraft(long, opts)).toMatchObject({ ok: false, reason: expect.stringContaining("too long") });
    expect(guardAiDraft(Array.from({ length: 110 }, () => "word").join(" "), opts).ok).toBe(true);
  });
  it.each([
    ["handover on 3 Dec", "date"],
    ["handover on 3rd December 2026", "date"],
    ["handover on December 3", "date"],
    ["handover 2026-12-03", "date"],
    ["handover 03/12", "date"],
    ["see https://example.com", "link"],
    ["visit www.studio.in", "link"],
    ["chat on wa.me/9198", "link"],
    ["we finish tomorrow", "relative"],
    ["done by next week", "relative"],
    ["about 2 weeks more", "week"],
    ["it will take 17 days", "day count"],
  ])("rejects invented content: %s (%s)", (text) => {
    expect(guardAiDraft(text, opts).ok).toBe(false);
  });
  it("rejects a date with a wrong year", () => {
    expect(guardAiDraft(`handover ${handoverText} 2031`, opts).ok).toBe(false);
  });
});

describe("AI rewrite falls back to the template", () => {
  const c = ck("2026-03-20", [w("carpentry", 40)]);
  const sched = computeSchedule(p, [...history, c], "2026-03-20");
  const guard = { allowedDates: allowedDates(p, sched), allowedDayCounts: allowedDayCounts(sched) };
  const reply = (text: string, status = 200) => async () => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status });

  it("uses the AI text when it passes the guard", async () => {
    const r = await rewriteDraft("TEMPLATE", guard, { apiKey: "k", fetchImpl: reply("Hello! Carpentry is 40% done.") as typeof fetch });
    expect(r).toEqual({ message: "Hello! Carpentry is 40% done.", source: "ai" });
  });
  it("falls back on a guard failure, an HTTP error and a network error", async () => {
    const impls: typeof fetch[] = [
      reply("Done by 31 Dec!") as typeof fetch,
      reply("x", 500) as typeof fetch,
      (async () => { throw new Error("offline"); }) as typeof fetch,
    ];
    for (const impl of impls) {
      const r = await rewriteDraft("TEMPLATE", guard, { apiKey: "k", fetchImpl: impl });
      expect(r.source).toBe("template");
      expect(r.message).toBe("TEMPLATE");
      expect(r.warning).toMatch(/AI rewrite was not used/);
    }
  });
  it("sends the model and key to the Messages API", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const impl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] })); }) as unknown as typeof fetch;
    await rewriteDraft("T", guard, { apiKey: "secret", model: "claude-test", fetchImpl: impl });
    expect(seen!.url).toBe("https://api.anthropic.com/v1/messages");
    expect((seen!.init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
    expect(JSON.parse(seen!.init.body as string).model).toBe("claude-test");
  });
});
