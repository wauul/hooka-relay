export type Role = "OWNER" | "ADMIN" | "MEMBER";
export const actions = ["view", "test", "replay", "manage", "invite", "roles", "kick", "leave", "transfer", "delete"] as const;
export type Action = typeof actions[number];
export function permitted(role: Role, action: Action, target?: Role) {
  if (action === "view" || action === "test" || action === "replay") return true;
  if (action === "leave") return role !== "OWNER";
  if (action === "delete" || action === "transfer") return role === "OWNER";
  if (action === "kick") return target !== undefined && target !== "OWNER" && (role === "OWNER" || (role === "ADMIN" && target === "MEMBER"));
  if (action === "roles") return target !== undefined && target !== "OWNER" && role !== "MEMBER";
  return role === "OWNER" || role === "ADMIN";
}
