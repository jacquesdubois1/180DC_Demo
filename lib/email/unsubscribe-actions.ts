"use server";

import { redirect } from "next/navigation";
import { readUnsubscribeToken, unsubscribeEmail } from "./unsubscribe";

export async function confirmUnsubscribe(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const email = await readUnsubscribeToken(token);
  if (!email) redirect(`/unsubscribe/${encodeURIComponent(token)}`);
  await unsubscribeEmail(email, "link");
  redirect(`/unsubscribe/${encodeURIComponent(token)}?done=1`);
}
