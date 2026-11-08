import { expect, test } from "@playwright/test";
import { signInAs } from "./helpers";

test("signed-out visitors are sent to the login page", async ({ page }) => {
  await page.goto("/hr/applications");
  await expect(page).toHaveURL(/\/login\?next=%2Fhr%2Fapplications/);
});

test("an interviewer can review but cannot open HR or outreach pages", async ({ page }) => {
  await signInAs(page, "Marc Puig");
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const path of ["/hr/applications", "/outreach", "/admin/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/forbidden/);
  }
});

test("Client Relations works on leads but cannot see applications", async ({ page }) => {
  await signInAs(page, "Omar Haddad");
  await page.goto("/outreach/pipeline");
  await expect(page).toHaveURL(/\/outreach\/pipeline/);
  await page.goto("/hr/applications");
  await expect(page).toHaveURL(/\/forbidden/);
});
