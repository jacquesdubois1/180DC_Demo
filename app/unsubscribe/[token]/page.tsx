import { CheckCircle2, MailX } from "lucide-react";
import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand";
import { SubmitButton } from "@/components/ui/submit-button";
import { maskEmail, readUnsubscribeToken } from "@/lib/email/unsubscribe";
import { confirmUnsubscribe } from "@/lib/email/unsubscribe-actions";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage(props: PageProps<"/unsubscribe/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const email = await readUnsubscribeToken(decodeURIComponent(token));
  const done = sp.done === "1";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4">
      <div className="mb-8"><BrandLockup /></div>
      {!email ? (
        <>
          <MailX className="mb-3 size-10 text-ink-3" />
          <h1 className="text-[26px] font-semibold tracking-tight">This link is not valid</h1>
          <p className="mt-2 text-ink-2">It may be incomplete. Reply to any of our e-mails with “unsubscribe” and we will remove you by hand.</p>
        </>
      ) : done ? (
        <>
          <CheckCircle2 className="mb-3 size-10 text-brand" />
          <h1 className="text-[26px] font-semibold tracking-tight">You are unsubscribed</h1>
          <p className="mt-2 text-ink-2">We will not send further outreach e-mails to <b>{maskEmail(email)}</b>. Any e-mails that were already scheduled have been cancelled.</p>
        </>
      ) : (
        <>
          <MailX className="mb-3 size-10 text-ink-2" />
          <h1 className="text-[26px] font-semibold tracking-tight">Stop e-mails from 180 Degrees Consulting Barcelona?</h1>
          <p className="mt-2 text-ink-2">We will stop contacting <b>{maskEmail(email)}</b> about pro-bono consulting projects. This takes effect immediately.</p>
          <form action={confirmUnsubscribe} className="mt-6">
            <input type="hidden" name="token" value={decodeURIComponent(token)} />
            <SubmitButton>Unsubscribe</SubmitButton>
          </form>
          <p className="mt-6 text-[12.5px] text-ink-3">Why do I see a button? Some e-mail security scanners open links automatically - the button makes sure only you can unsubscribe.</p>
        </>
      )}
    </main>
  );
}
