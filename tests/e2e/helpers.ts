import { expect, type Page } from "@playwright/test";

/** Sign in as one of the fictional demo personas. */
export async function signInAs(page: Page, persona: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(persona) }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await expect(page.getByText(persona).first()).toBeVisible();
}
