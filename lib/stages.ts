import type { Stage } from "./types";

/**
 * PLACEHOLDER stage template. The studio owner has not confirmed real stages
 * and durations yet (see docs/fde/NOTES.md, open questions).
 */
export const DEFAULT_STAGES: Stage[] = [
  { id: "civil", name: "Civil & demolition", short: "Civil", trade: "Civil team", plannedDays: 7, dependsOn: [] },
  { id: "elec", name: "Electrical & plumbing lines", short: "Elec & plumbing", trade: "Electrician / plumber", plannedDays: 6, dependsOn: ["civil"] },
  { id: "ceiling", name: "False ceiling", short: "Ceiling", trade: "Ceiling team", plannedDays: 7, dependsOn: ["elec"] },
  { id: "carpentry", name: "Carpentry", short: "Carpentry", trade: "Carpenter", plannedDays: 25, dependsOn: ["elec"] },
  { id: "paint", name: "Putty & paint", short: "Paint", trade: "Painter", plannedDays: 10, dependsOn: ["ceiling", "carpentry"] },
  { id: "fittings", name: "Fittings", short: "Fittings", trade: "Fitting team", plannedDays: 4, dependsOn: ["paint"] },
  { id: "handover", name: "Cleaning & handover", short: "Handover", trade: "Cleaning crew", plannedDays: 2, dependsOn: ["fittings"] },
];
