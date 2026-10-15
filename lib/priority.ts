// Versiya 3.32: "Vaciblik" of personal works, tasks and requests. A task or request made from a work (or from another task /
// request) takes its importance from there; old rows and the director's dərkənar are "Orta".
export const PRIORITIES = ["Yüksək", "Orta", "Aşağı"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = "Orta";

export function toPriority(value: unknown): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : DEFAULT_PRIORITY;
}

// For sorting: Yüksək first.
export function priorityRank(value: unknown) {
  return PRIORITIES.indexOf(toPriority(value));
}
