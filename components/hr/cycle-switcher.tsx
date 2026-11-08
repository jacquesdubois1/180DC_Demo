"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

export function CycleSwitcher({ cycles, current }: { cycles: { slug: string; name: string; status: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select aria-label="Recruitment cycle" className="w-auto min-w-44" value={current}
      onChange={(e) => {
        const p = new URLSearchParams(params.toString());
        p.set("cycle", e.target.value);
        router.push(`${pathname}?${p.toString()}`);
      }}>
      {cycles.map((c) => (
        <option key={c.slug} value={c.slug}>{c.name}{c.status === "open" ? " (open)" : ""}</option>
      ))}
    </Select>
  );
}
