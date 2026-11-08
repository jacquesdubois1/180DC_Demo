"use client";

import { Download, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { erasePerson, removeSuppression, retryFailedEmails, runRetentionNow, setUserActive, setUserRoles, updateUserProfile } from "@/lib/admin/actions";
import { APP_ROLES, type AppRole, ROLE_LABELS } from "@/lib/auth/roles";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message ?? "Saved");
      else toast.error(r.error ?? "Something went wrong");
    });
  return { pending, run };
}

const DEPARTMENTS = ["board", "hr", "client_relations", "consulting", "analytics", "events", "finance", "marketing", "other"];

export function UserRoleEditor({ user, isSelf }: {
  user: { id: string; roles: AppRole[]; is_active: boolean; department: string; title: string | null }; isSelf: boolean;
}) {
  const [roles, setRoles] = useState<AppRole[]>(user.roles);
  const [department, setDepartment] = useState(user.department);
  const [title, setTitle] = useState(user.title ?? "");
  const { pending, run } = useRun();
  const dirty = roles.slice().sort().join() !== user.roles.slice().sort().join();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap gap-1.5">
        {APP_ROLES.filter((r) => r !== "member").map((r) => (
          <button key={r} type="button" disabled={pending || (isSelf && r === "admin")}
            onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] disabled:opacity-60 ${roles.includes(r) ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-3 hover:bg-surface-2"}`}>
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      {dirty ? <Button size="sm" disabled={pending} onClick={() => run(() => setUserRoles(user.id, roles))}>Save roles</Button> : null}
      <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-8 w-40 text-[13px]" aria-label="Department">
        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d.replace("_", " ")}</option>)}
      </Select>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. VP HR" className="h-8 w-44 text-[13px]" aria-label="Title" />
      {department !== user.department || title !== (user.title ?? "") ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => updateUserProfile(user.id, { department: department as "other", title }))}>Save profile</Button>
      ) : null}
      {!isSelf ? (
        <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={() => {
          if (!user.is_active || confirm("Deactivate this user? They can no longer sign in; open review assignments are released."))
            run(() => setUserActive(user.id, !user.is_active));
        }}>{user.is_active ? "Deactivate" : "Reactivate"}</Button>
      ) : <span className="ml-auto text-[12px] text-ink-3">you</span>}
    </div>
  );
}

export function RetentionButton({ due }: { due: number }) {
  const { pending, run } = useRun();
  return (
    <Button variant={due ? "primary" : "outline"} disabled={pending} onClick={() => {
      if (!due || confirm(`Anonymise ${due} application(s) now? CVs and contact details are deleted permanently.`)) run(() => runRetentionNow());
    }}><RefreshCw />{due ? `Anonymise ${due} now` : "Run check now"}</Button>
  );
}

export function AccessRequest() {
  // a plain GET form: the browser downloads the JSON file the route returns
  return (
    <form action="/api/admin/dsar" method="get" className="flex flex-wrap items-end gap-2">
      <Field label="E-mail address of the person" className="min-w-64 flex-1"><Input type="email" name="email" required /></Field>
      <Button type="submit" variant="outline"><Download />Download data (JSON)</Button>
    </form>
  );
}

export function ErasureRequest() {
  const [email, setEmail] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const { pending, run } = useRun();
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="E-mail address"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Type it again to confirm"><Input type="email" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3"><ShieldAlert className="size-4 text-danger" />Permanent. Statistics stay valid because scores are kept without the person.</p>
        <Button variant="danger" disabled={pending || !email || email.toLowerCase() !== confirmText.toLowerCase()}
          onClick={() => run(async () => {
            const r = await erasePerson(email, confirmText);
            if (r.ok) { setEmail(""); setConfirmText(""); }
            return r;
          })}><Trash2 />Erase person</Button>
      </div>
    </div>
  );
}

export function SuppressionRow({ s }: { s: { id: string; target: string; reason: string; source: string | null; created_at: string } }) {
  const { pending, run } = useRun();
  return (
    <div className="flex items-center gap-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{s.target}</span>
      <Badge tone={s.reason === "gdpr_erasure" ? "danger" : s.reason === "unsubscribe" ? "warn" : "neutral"}>{s.reason.replace("_", " ")}</Badge>
      <span className="w-28 text-right text-[12px] text-ink-3">{new Date(s.created_at).toLocaleDateString("en-GB")}</span>
      {s.reason !== "gdpr_erasure" ? (
        <button className="text-[12px] text-ink-3 hover:text-danger disabled:opacity-50" disabled={pending}
          onClick={() => { if (confirm("Allow e-mails to this address again? Only do this if the person asked for it.")) run(() => removeSuppression(s.id)); }}>remove</button>
      ) : <span className="w-[42px]" />}
    </div>
  );
}

export function RetryEmailsButton({ failed }: { failed: number }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="outline" disabled={pending || !failed} onClick={() => run(() => retryFailedEmails())}><RefreshCw />Retry {failed} failed</Button>;
}
