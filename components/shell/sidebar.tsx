"use client";

import {
  Activity, Building2, Calendar, ClipboardCheck, FlaskConical, Home, Kanban, LayoutDashboard, Lock, LogOut, Menu,
  Scale, ScrollText, Send, Settings, Shield, Shuffle, Sparkles, Upload, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandLockup } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import type { CurrentUser } from "@/lib/auth/roles";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import type { NavSection } from "./nav";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home, "layout-dashboard": LayoutDashboard, kanban: Kanban, users: Users, shuffle: Shuffle, scale: Scale,
  calendar: Calendar, settings: Settings, "clipboard-check": ClipboardCheck, building: Building2, send: Send, upload: Upload,
  sparkles: Sparkles, flask: FlaskConical, shield: Shield, lock: Lock, scroll: ScrollText, activity: Activity,
};

export function Sidebar({ sections, user, badges }: {
  sections: NavSection[]; user: CurrentUser; badges: Record<string, number>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + "/"));

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-4 pt-5">
        <Link href="/" onClick={() => setOpen(false)}><BrandLockup /></Link>
        <button className="rounded-md p-1 text-ink-3 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="size-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {sections.map((s) => (
          <div key={s.title ?? "root"} className="mb-3">
            {s.title ? <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{s.title}</div> : null}
            {s.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Home;
              const active = isActive(item.href, item.exact);
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                  className={cn("mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors",
                    active ? "bg-brand-soft font-medium text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink")}>
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {badges[item.href] ? (
                    <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white dark:text-[#0d1a12] tabular">{badges[item.href]}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user.name}</div>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {user.roles.filter((r) => r !== "member").slice(0, 2).map((r) => (
                <Badge key={r} tone="outline" className="px-1.5 py-0 text-[10.5px]">{ROLE_LABELS[r]}</Badge>
              ))}
            </div>
          </div>
          <form action={signOut}>
            <button className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
        <BrandLockup />
        <button className="rounded-md p-1.5 text-ink-2" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-5" /></button>
      </div>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-line bg-surface lg:block">{nav}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">{nav}</aside>
        </div>
      ) : null}
    </>
  );
}
