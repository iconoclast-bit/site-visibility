import { DEFAULT_STAGES } from "@/lib/stages";
import type { Checkin, Project, StageUpdate } from "@/lib/types";

export const START = "2026-03-02"; // a Monday

export function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    slug: "sharma",
    name: "Sharma 3BHK",
    clientName: "Priya Sharma",
    address: "B-42 Secret Society, Sector 56",
    locality: "Sector 56, Gurgaon",
    homeType: "3BHK",
    style: "Contemporary",
    showcase: false,
    startDate: START,
    clientToken: "client-p1",
    supervisorId: "sup1",
    stages: DEFAULT_STAGES,
    ...over,
  };
}

let n = 0;
export function ck(date: string, updates: StageUpdate[], over: Partial<Checkin> = {}): Checkin {
  n += 1;
  return {
    id: `ck-${n}-${date}`,
    projectId: "p1",
    supervisorId: "sup1",
    date,
    createdAt: `${date}T10:00:00.000Z`,
    updates,
    note: "",
    photos: [],
    location: null,
    review: "approved",
    ...over,
  };
}

export const w = (stageId: string, percent: number): StageUpdate => ({ stageId, state: "working", percent });
export const done = (stageId: string): StageUpdate => ({ stageId, state: "done" });
export const blocked = (stageId: string, blockedReason: string, percent?: number): StageUpdate => ({ stageId, state: "blocked", blockedReason, percent });
