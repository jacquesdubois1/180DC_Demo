/** {{placeholder}} rendering for e-mail templates. Unknown placeholders are reported, not silently dropped. */
export function renderTemplate(text: string, vars: Record<string, string | null | undefined>) {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || v === "") {
      missing.add(key);
      return `{{${key}}}`;
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}

export const PLACEHOLDERS: Record<string, string> = {
  first_name: "Recipient's first name",
  position: "Track the candidate applied for",
  cycle: "Recruitment cycle, e.g. Spring 2027",
  sender_name: "Name of the member sending the e-mail",
  scheduling_link: "Link to book an interview slot",
  organization: "Organisation name",
  sector: "Organisation's sector",
  project_idea: "Project idea noted on the lead",
  unsubscribe_link: "Personal opt-out link (added automatically)",
};
