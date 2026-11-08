import type { AppRole } from "@/lib/auth/roles";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved in the client sidebar
  exact?: boolean;
}
export interface NavSection {
  title: string | null;
  roles: AppRole[] | null; // null = everyone
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { title: null, roles: null, items: [{ href: "/", label: "Home", icon: "home", exact: true }] },
  {
    title: "Recruitment",
    roles: ["hr"],
    items: [
      { href: "/hr", label: "Overview", icon: "layout-dashboard", exact: true },
      { href: "/hr/pipeline", label: "Pipeline", icon: "kanban" },
      { href: "/hr/applications", label: "Applications", icon: "users" },
      { href: "/hr/assign", label: "Assign reviewers", icon: "shuffle" },
      { href: "/hr/calibration", label: "Score calibration", icon: "scale" },
      { href: "/hr/interviews", label: "Interviews", icon: "calendar" },
      { href: "/hr/settings", label: "Cycles & forms", icon: "settings" },
    ],
  },
  { title: "Reviewing", roles: ["interviewer", "hr"], items: [{ href: "/reviews", label: "My reviews", icon: "clipboard-check" }] },
  {
    title: "Client outreach",
    roles: ["client_relations"],
    items: [
      { href: "/outreach", label: "Overview", icon: "layout-dashboard", exact: true },
      { href: "/outreach/pipeline", label: "Lead pipeline", icon: "kanban" },
      { href: "/outreach/organizations", label: "Organisations", icon: "building" },
      { href: "/outreach/campaigns", label: "Send e-mails", icon: "send" },
      { href: "/outreach/import", label: "Import prospects", icon: "upload" },
      { href: "/outreach/research", label: "AI lead research", icon: "sparkles" },
      { href: "/outreach/templates", label: "Templates & A/B tests", icon: "flask" },
      { href: "/outreach/scoring", label: "Scoring model", icon: "gauge" },
    ],
  },
  {
    title: "Admin",
    roles: ["admin"],
    items: [
      { href: "/admin/users", label: "Users & roles", icon: "shield" },
      { href: "/admin/privacy", label: "Privacy & GDPR", icon: "lock" },
      { href: "/admin/audit", label: "Audit log", icon: "scroll" },
      { href: "/admin/system", label: "System", icon: "activity" },
    ],
  },
];
