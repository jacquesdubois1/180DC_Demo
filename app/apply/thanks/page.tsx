import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand";

export const metadata: Metadata = { title: "Application received" };

export default async function Thanks(props: PageProps<"/apply/thanks">) {
  const sp = await props.searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : null;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4">
      <div className="mb-8"><BrandLockup /></div>
      <CheckCircle2 className="mb-3 size-10 text-brand" />
      <h1 className="text-[28px] font-semibold tracking-tight">Thank you - your application is in</h1>
      <p className="mt-2 text-ink-2">We sent a confirmation to your e-mail address. Every application is read by at least two members of our team; you will hear from us within two weeks.</p>
      {ref ? <p className="mt-4 text-[13px] text-ink-3">Reference: <span className="font-mono">{ref}</span></p> : null}
    </main>
  );
}
