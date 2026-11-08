import path from "node:path";
import { expect, test } from "@playwright/test";

test("a student applies through the public form and gets a reference", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/apply");
  await page.fill("input[name=first_name]", "Testa");
  await page.fill("input[name=last_name]", "Persona");
  await page.fill("input[name=email]", `testa.${stamp}@students.example.org`);
  await page.fill("input[name=degree_program]", "MSc Business Analytics");
  await page.selectOption("select[name=study_year]", "Master");
  await page.getByText("Analytics", { exact: true }).first().click();
  for (const ta of await page.locator("textarea").all()) await ta.fill("I built an impact dashboard for a food bank with Python and Power BI, and I want to bring this to 180DC.");
  await page.setInputFiles("input[name=cv]", path.join(__dirname, "fixtures/cv.pdf"));
  await page.check("input[name=consent]");
  await page.waitForTimeout(4200); // the form rejects submissions faster than a human (bot protection)
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/apply\/thanks\?ref=C-[0-9A-F]{6}/, { timeout: 30_000 });
});

test("the form refuses a non-PDF CV", async ({ page }) => {
  await page.goto("/apply");
  await page.fill("input[name=first_name]", "Bot");
  await page.fill("input[name=last_name]", "Check");
  await page.fill("input[name=email]", `bot.${Date.now()}@students.example.org`);
  await page.fill("input[name=degree_program]", "BBA");
  await page.selectOption("select[name=study_year]", "Master");
  await page.getByText("Analytics", { exact: true }).first().click();
  for (const ta of await page.locator("textarea").all()) await ta.fill("A sufficiently long motivation text for the validation to pass, with enough characters.");
  await page.setInputFiles("input[name=cv]", { name: "cv.docx", mimeType: "application/octet-stream", buffer: Buffer.from("PK not a pdf") });
  await page.check("input[name=consent]");
  await page.waitForTimeout(4200);
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/apply$/);
  await expect(page.getByText("The file must be a PDF")).toBeVisible();
});
