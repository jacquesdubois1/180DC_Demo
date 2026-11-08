import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-start justify-center gap-3 px-4">
      <div className="eyebrow">403</div>
      <h1 className="text-2xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="text-ink-2">Your role does not include this area. If you think this is wrong, ask an admin to grant you the role.</p>
      <Button asChild variant="outline"><Link href="/">Back to the Hub</Link></Button>
    </main>
  );
}
