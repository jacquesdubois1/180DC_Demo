export const APP_ROLES = ["admin", "hr", "interviewer", "client_relations", "member"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  hr: "HR",
  interviewer: "Interviewer",
  client_relations: "Client Relations",
  member: "Member",
};

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  department: string;
  title: string | null;
  roles: AppRole[];
  isDemo: boolean;
}

/** admin implies every role - mirrors app.has_any_role() in the database */
export function hasRole(user: Pick<CurrentUser, "roles"> | null | undefined, ...roles: AppRole[]): boolean {
  if (!user) return false;
  return user.roles.includes("admin") || roles.some((r) => user.roles.includes(r));
}

export const can = {
  hr: (u: CurrentUser | null) => hasRole(u, "hr"),
  review: (u: CurrentUser | null) => hasRole(u, "hr", "interviewer"),
  outreach: (u: CurrentUser | null) => hasRole(u, "client_relations"),
  admin: (u: CurrentUser | null) => hasRole(u, "admin"),
};
