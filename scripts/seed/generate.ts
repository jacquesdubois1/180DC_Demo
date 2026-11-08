/**
 * Generates supabase/seed.sql: a realistic but completely FICTIONAL data set.
 * No real applicants, members or companies. All e-mail addresses use reserved
 * example domains (RFC 2606), so nothing can ever be sent to a real person.
 *
 *   npm run db:seed:generate   (then npm run db:reset)
 *
 * Built-in "ground truth" makes the analytics demonstrable:
 *   - every applicant has a latent quality; reviewers differ in severity
 *     (Marc is harsh, Sofia lenient) -> the calibration model should recover this
 *   - outreach template variant B has a genuinely higher reply rate than A
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { makeCvPdf } from "./pdf";
import { Rng, slugify } from "./random";
import { ago, ahead, bytea, dateAgo, dateAhead, insert, json, type V } from "./sql";

const rng = new Rng(180);
const OUT = path.resolve(__dirname, "../../supabase/seed.sql");
const DEMO_DOMAIN = "180dc-demo.example.org";

type Row = Record<string, V>;
const T: Record<string, Row[]> = {};
const add = (table: string, row: Row) => (T[table] ??= []).push(row);

// ---------------------------------------------------------------------------
// Demo members & roles (fictional personas)
// ---------------------------------------------------------------------------
const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const USERS = [
  { id: uid(1), first: "Alex", last: "Romero", dept: "board", title: "Head of Internal Tooling", roles: ["admin", "member"] },
  { id: uid(2), first: "Laura", last: "Martín", dept: "hr", title: "HR Director", roles: ["hr", "member"] },
  { id: uid(3), first: "Nuria", last: "Vidal", dept: "hr", title: "HR Manager", roles: ["hr", "interviewer", "member"] },
  { id: uid(4), first: "Marc", last: "Puig", dept: "consulting", title: "Consulting Director", roles: ["interviewer", "member"], severity: -0.65, senior: true },
  { id: uid(5), first: "Sofía", last: "Rossi", dept: "consulting", title: "Project Leader", roles: ["interviewer", "member"], severity: 0.55 },
  { id: uid(6), first: "Jonas", last: "Weber", dept: "analytics", title: "Analytics Director", roles: ["interviewer", "member"], severity: -0.1, senior: true },
  { id: uid(7), first: "Clara", last: "Dubois", dept: "consulting", title: "Project Leader", roles: ["interviewer", "member"], severity: 0.25 },
  { id: uid(8), first: "Arjun", last: "Mehta", dept: "consulting", title: "Senior Consultant", roles: ["interviewer", "member"], severity: -0.3 },
  { id: uid(9), first: "Omar", last: "Haddad", dept: "client_relations", title: "Client Relations Director", roles: ["client_relations", "member"] },
  { id: uid(10), first: "Daniel", last: "García", dept: "client_relations", title: "Deputy Director, Client Relations", roles: ["client_relations", "member"] },
  { id: uid(11), first: "Emma", last: "Schmidt", dept: "consulting", title: "Impact Consultant", roles: ["member"] },
] as const;
const severity = new Map<string, number>(USERS.map((u) => [u.id, "severity" in u ? u.severity : 0]));
const REVIEWERS = USERS.filter((u) => u.roles.includes("interviewer" as never));

for (const u of USERS) {
  const personId = rng.uuid();
  const email = `${slugify(u.first)}.${slugify(u.last)}@${DEMO_DOMAIN}`;
  add("public.people", { id: personId, first_name: u.first, last_name: u.last, email, city: "Barcelona", created_at: ago(400) });
  add("public.person_roles", { person_id: personId, role: "member", department: u.dept, title: u.title, start_date: dateAgo(rng.int(200, 700)) });
  add("public.app_users", { id: u.id, person_id: personId, email, display_name: `${u.first} ${u.last}`, department: u.dept, title: u.title, is_demo: true });
  for (const r of u.roles) add("public.user_roles", { user_id: u.id, role: r });
}

// ---------------------------------------------------------------------------
// Rubrics (anchored 1-5 scales)
// ---------------------------------------------------------------------------
const SCREENING_RUBRIC = rng.uuid();
const INTERVIEW_RUBRIC = rng.uuid();
add("public.rubrics", { id: SCREENING_RUBRIC, name: "Written application (screening)", stage: "screening" });
add("public.rubrics", { id: INTERVIEW_RUBRIC, name: "Interview & case", stage: "interview" });
const SCREENING_CRITERIA = [
  ["motivation", "Motivation & fit with 180DC", "Why 180DC, why now; specific, not generic", { 1: "Generic or missing", 3: "Clear but generic", 5: "Specific, personal and convincing" }, 1.5],
  ["impact_orientation", "Impact orientation", "Evidence of caring about social or environmental impact", { 1: "No evidence", 3: "Some interest", 5: "Track record of impact work" }, 1.2],
  ["analytical_thinking", "Analytical thinking", "Structured reasoning, use of evidence", { 1: "Unstructured", 3: "Mostly structured", 5: "Sharp, structured, evidence-based" }, 1.2],
  ["communication", "Written communication", "Clarity, conciseness, tone", { 1: "Hard to follow", 3: "Clear", 5: "Crisp and compelling" }, 1],
  ["teamwork", "Teamwork & collaboration", "Works well in diverse teams", { 1: "No evidence", 3: "Some examples", 5: "Strong, reflected examples" }, 1],
] as const;
const INTERVIEW_CRITERIA = [
  ["problem_solving", "Case: problem solving", "Hypothesis-driven structure, math, insight", { 1: "Lost", 3: "Solid", 5: "Outstanding" }, 1.5],
  ["structured_communication", "Structured communication", "Top-down, synthesis, listening", { 1: "Unclear", 3: "Clear", 5: "Partner-level" }, 1.2],
  ["client_orientation", "Client orientation", "Empathy for NGOs / social enterprises", { 1: "None", 3: "Some", 5: "Strong" }, 1],
  ["team_fit", "Team fit", "Collaborative, coachable, humble", { 1: "Concerns", 3: "Good", 5: "Excellent" }, 1],
  ["drive", "Drive & ownership", "Takes initiative, follows through", { 1: "Low", 3: "Good", 5: "Exceptional" }, 1],
] as const;
SCREENING_CRITERIA.forEach(([key, label, description, anchors, weight], i) =>
  add("public.rubric_criteria", { rubric_id: SCREENING_RUBRIC, key, label, description, anchors: json(anchors), weight, position: i }));
INTERVIEW_CRITERIA.forEach(([key, label, description, anchors, weight], i) =>
  add("public.rubric_criteria", { rubric_id: INTERVIEW_RUBRIC, key, label, description, anchors: json(anchors), weight, position: i }));

// ---------------------------------------------------------------------------
// Recruitment cycles & tracks
// ---------------------------------------------------------------------------
const COMMON_Q = [
  { key: "motivation", label: "Why do you want to join 180 Degrees Consulting Barcelona?", type: "long_text", required: true, max_words: 250 },
  { key: "impact_experience", label: "Describe an experience where you created social or environmental impact.", type: "long_text", required: true, max_words: 250 },
  { key: "teamwork", label: "Tell us about a time you worked in a diverse team. What did you learn?", type: "long_text", required: true, max_words: 200 },
];
const TRACKS = [
  { slug: "impact-consultants", name: "Impact Consultants", dept: "consulting", places: 20, weight: 50, extra: [] as typeof COMMON_Q },
  { slug: "analytics", name: "Analytics", dept: "analytics", places: 6, weight: 18,
    extra: [{ key: "analytics_project", label: "Describe a data or analytics project you are proud of (tools, method, result).", type: "long_text", required: true, max_words: 250 }] },
  { slug: "associates", name: "Associates", dept: "consulting", places: 8, weight: 20, extra: [] },
  { slug: "board", name: "Board", dept: "board", places: 3, weight: 6,
    extra: [{ key: "vision", label: "What would you change at 180DC Barcelona in your first 100 days?", type: "long_text", required: true, max_words: 300 }] },
  { slug: "contract-renewal", name: "Contract Renewal", dept: "consulting", places: null, weight: 6,
    extra: [{ key: "renewal_reflection", label: "Reflect on your last term: what went well, what will you do differently?", type: "long_text", required: true, max_words: 250 }] },
];
const CYCLES = [
  { key: "current", name: "Spring 2027", slug: "spring-2027", status: "open", opens: ago(28), closes: ahead(14), retention: 180, n: 142 },
  { key: "previous", name: "Autumn 2026", slug: "autumn-2026", status: "closed", opens: ago(110), closes: ago(80), retention: 180, n: 108 },
  { key: "old", name: "Spring 2026", slug: "spring-2026", status: "archived", opens: ago(290), closes: ago(255), retention: 180, n: 60 },
];
const cycleIds = new Map<string, string>();
const positionIds = new Map<string, string>(); // `${cycleKey}:${slug}`
for (const c of CYCLES) {
  const id = rng.uuid();
  cycleIds.set(c.key, id);
  add("public.recruitment_cycles", { id, name: c.name, slug: c.slug, status: c.status, opens_at: c.opens, closes_at: c.closes,
    retention_days: c.retention, blind_screening: true, reviewers_per_application: 2, created_by: uid(2) });
  TRACKS.forEach((t, i) => {
    const pid = rng.uuid();
    positionIds.set(`${c.key}:${t.slug}`, pid);
    add("public.positions", { id: pid, cycle_id: id, name: t.name, slug: t.slug, department: t.dept,
      description: trackDescription(t.slug), places: t.places, is_open: c.status === "open",
      questions: json([...COMMON_Q, ...t.extra]), screening_rubric_id: SCREENING_RUBRIC, interview_rubric_id: INTERVIEW_RUBRIC, position: i });
  });
  if (c.key === "current") {
    for (const r of REVIEWERS) {
      const expert = r.dept === "analytics" ? ["analytics"] : r.dept === "hr" ? ["contract-renewal", "associates"] : ["impact-consultants", "associates", "board"];
      add("public.reviewer_pool", { cycle_id: id, user_id: r.id, max_reviews: r.id === uid(3) ? 12 : rng.int(18, 26),
        position_ids: raw2uuidArray(expert.map((s) => positionIds.get(`current:${s}`)!)), is_senior: "senior" in r && !!r.senior });
    }
  }
}
function raw2uuidArray(ids: string[]) {
  return { raw: `ARRAY[${ids.map((i) => `'${i}'`).join(",")}]::uuid[]` };
}
function trackDescription(slug: string) {
  return ({
    "impact-consultants": "Work in teams of 5-6 on pro bono consulting projects for NGOs and social enterprises.",
    analytics: "Build the analytics behind our projects: market sizing, impact measurement, dashboards.",
    associates: "First-year track: learn consulting fundamentals while supporting a project team.",
    board: "Lead a department of 180DC Barcelona and shape the association's strategy.",
    "contract-renewal": "Existing members applying to continue for another term.",
  } as Record<string, string>)[slug];
}

// ---------------------------------------------------------------------------
// Applicants
// ---------------------------------------------------------------------------
const FIRST = ["Lucía", "Martina", "Pablo", "Hugo", "Carla", "Mateo", "Elena", "Álvaro", "Paula", "Diego", "Julia", "Leo", "Marta", "Adrián",
  "Sara", "Javier", "Inés", "Bruno", "Valentina", "Nicolás", "Chloé", "Louis", "Camille", "Hannah", "Lukas", "Lena", "Felix", "Giulia",
  "Lorenzo", "Francesca", "Sophie", "Daan", "Emma", "Liam", "Olivia", "Noah", "Ana", "João", "Mariana", "Priya", "Rohan", "Aisha",
  "Yusuf", "Mei", "Wei", "Hiroshi", "Yuki", "Santiago", "Camila", "Isabella", "Sebastián", "Gabriela", "Andrés", "Zoe", "Max", "Ida"];
const LAST = ["García", "Fernández", "López", "Martínez", "Sánchez", "Pérez", "Gómez", "Ruiz", "Serra", "Vila", "Ferrer", "Soler",
  "Müller", "Schneider", "Fischer", "Wagner", "Becker", "Rossi", "Bianchi", "Romano", "Colombo", "Martin", "Bernard", "Lefèvre",
  "Moreau", "de Jong", "Jansen", "Smith", "Johnson", "Silva", "Santos", "Costa", "Sharma", "Patel", "Khan", "Chen", "Wang",
  "Tanaka", "Sato", "Rodríguez", "Morales", "Castillo", "Herrera", "Nowak", "Kowalski", "Andersson", "Nielsen", "Murphy", "O'Brien"];
const NATIONALITIES = [["Spanish", 34], ["German", 10], ["French", 9], ["Italian", 9], ["Dutch", 4], ["Portuguese", 3], ["Mexican", 5],
  ["Colombian", 4], ["Indian", 6], ["Chinese", 4], ["American", 4], ["Polish", 2], ["Swedish", 2], ["Irish", 2], ["Japanese", 2]] as const;
const UNIS = [["ESADE Business School", 70], ["Universitat Pompeu Fabra", 10], ["Universitat de Barcelona", 6],
  ["IESE Business School", 3], ["Bocconi University (exchange)", 4], ["HEC Paris (exchange)", 3], ["WU Vienna (exchange)", 2], ["LSE (exchange)", 2]] as const;
const PROGRAMS = [["BBA", 34], ["MSc Business Analytics", 12], ["Master in Management", 12], ["MSc Finance", 8],
  ["Double Degree BBA + Law", 8], ["Global Governance", 6], ["MSc Marketing", 6], ["Data Science & AI", 6], ["MBA", 4], ["Economics", 6]] as const;
const HEARD = [["Instagram", 22], ["A friend / member", 30], ["Esade club fair", 25], ["LinkedIn", 12], ["Professor", 4], ["Newsletter", 7]] as const;
const LANGS = ["English", "Spanish", "Catalan", "French", "German", "Italian", "Portuguese", "Mandarin", "Hindi", "Dutch"];

const MOTIVATION = [
  "I want to use what I learn in my degree for organisations that improve lives, not only for profit. 180DC is the place where consulting skills meet real social impact.",
  "After volunteering with a food bank in my hometown I realised that many NGOs lack the strategic support companies take for granted. I want to bring structure and data to them.",
  "Your project with a circular-fashion start-up convinced me: you deliver real recommendations, not student exercises. I want to learn from that and contribute my analytical skills.",
  "I am curious about consulting but I want my first projects to matter. 180DC combines rigorous problem solving with purpose, and a community of motivated people.",
  "I would like to join because I want to grow as a team player and learn how to frame messy problems for clients who have limited resources.",
  "Consulting looks interesting and 180DC is well known at Esade.",
];
const IMPACT = [
  "I co-founded a tutoring programme for refugee children in Barcelona; we grew from 6 to 40 volunteers and I built the scheduling system ourselves.",
  "As treasurer of a student sustainability club I introduced a simple impact tracker that convinced our university to fund reusable cups for all campus cafés.",
  "During an internship at a microfinance NGO in Colombia I analysed repayment data and proposed a new reminder process that reduced late payments.",
  "I organised a beach clean-up series with 200 participants and partnered with the city council for logistics.",
  "I volunteered at a local animal shelter on weekends during high school.",
  "I have not led an impact project yet, but I donate regularly and follow sustainability topics closely.",
];
const TEAMWORK = [
  "In a case competition our team had five nationalities and very different working styles. I learnt to agree on decision rules early, which saved us a lot of time later.",
  "In a group project one teammate stopped contributing. I talked to them privately, understood they were overwhelmed, and we redistributed the work.",
  "Working in a hackathon team taught me to listen first and to say clearly what I can deliver by when.",
  "I usually take the role of the organiser in group projects and make sure we meet deadlines.",
];
const ANALYTICS = [
  "I built a demand-forecasting model in Python (gradient boosting) for a café chain and visualised it in Power BI; it cut food waste by 12% in a pilot.",
  "For my thesis I scraped housing listings and estimated a hedonic price model; I presented the results to the city's housing office.",
  "I automated a weekly sales report with SQL and Excel Power Query, saving my team four hours a week.",
];
const VISION = [
  "I would professionalise our client pipeline and alumni network, so we can choose projects strategically instead of taking whatever comes.",
  "I would create a training curriculum so first-years ramp up faster, and measure the impact of our projects one year after delivery.",
];
const RENEWAL = [
  "My project went well on the analysis side; next term I want to improve how we manage the client's expectations from week one.",
  "I learnt a lot as an associate; I now want to take more responsibility and mentor new members.",
];

function answerFor(key: string, q: number) {
  const pickBy = (arr: string[]) => {
    const idx = Math.max(0, Math.min(arr.length - 1, Math.round((5 - q) / 4 * (arr.length - 1) + rng.normal(0, 0.8))));
    return arr[idx];
  };
  return ({ motivation: pickBy(MOTIVATION), impact_experience: pickBy(IMPACT), teamwork: pickBy(TEAMWORK),
    analytics_project: pickBy(ANALYTICS), vision: pickBy(VISION), renewal_reflection: pickBy(RENEWAL) } as Record<string, string>)[key];
}

const usedEmails = new Set<string>();
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
type Stage = "received" | "screening" | "interview" | "final_review" | "offer_sent" | "offer_accepted" | "offer_declined" | "waitlisted" | "rejected" | "withdrawn";
const PATH: Stage[] = ["received", "screening", "interview", "final_review", "offer_sent", "offer_accepted"];

const REJECT_SCREENING = [
  "Written application below the bar on motivation and impact orientation.",
  "Strong profile but limited evidence of impact interest; encouraged to re-apply.",
  "Answers too generic for the track; other candidates more specific.",
];
const REJECT_INTERVIEW = [
  "Case interview: structure and synthesis below the bar.",
  "Good motivation, but the interview panel had concerns about availability this term.",
  "Solid interview, but other candidates were stronger for the limited places.",
];

let appCount = 0;
for (const c of CYCLES) {
  const cycleId = cycleIds.get(c.key)!;
  const people = Array.from({ length: c.n }, () => {
    const q = clamp(rng.normal(3.15, 0.75), 1.3, 4.9);
    return { q, s: q + rng.normal(0, 0.45) };
  });
  // assign stages: recent submissions not yet processed; the rest by (noisy) quality
  const order = people.map((p, i) => ({ ...p, i })).sort((a, b) => a.s - b.s);
  const stageOf = new Map<number, { stage: Stage; reachedInterview: boolean }>();
  order.forEach((p, rank) => {
    const pct = rank / order.length;
    let stage: Stage;
    let reachedInterview = false;
    if (c.key === "current") {
      if (rng.chance(0.22)) stage = "received";
      else if (rng.chance(0.3)) stage = "screening";
      else if (pct < 0.3) stage = "rejected";
      else if (pct < 0.45) { stage = "rejected"; reachedInterview = true; }
      else if (pct < 0.72) stage = "interview";
      else if (pct < 0.82) stage = "final_review";
      else if (pct < 0.87) stage = "waitlisted";
      else if (pct < 0.93) stage = "offer_sent";
      else stage = "offer_accepted";
      if (rng.chance(0.015)) stage = "withdrawn";
    } else {
      if (pct < 0.42) stage = "rejected";
      else if (pct < 0.62) { stage = "rejected"; reachedInterview = true; }
      else if (pct < 0.66) stage = "offer_declined";
      else stage = "offer_accepted";
      if (rng.chance(0.05)) stage = "withdrawn";
    }
    stageOf.set(p.i, { stage, reachedInterview });
  });

  people.forEach((p, i) => {
    const { stage, reachedInterview } = stageOf.get(i)!;
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    let email = `${slugify(first)}.${slugify(last)}@students.example.org`;
    while (usedEmails.has(email)) email = `${slugify(first)}.${slugify(last)}${rng.int(1, 999)}@students.example.org`;
    usedEmails.add(email);
    const track = rng.weighted(TRACKS.map((t) => [t, t.weight] as const));
    const nationality = rng.weighted(NATIONALITIES);
    const uni = rng.weighted(UNIS);
    const program = rng.weighted(PROGRAMS);
    const year = rng.pick(["1st year", "2nd year", "3rd year", "4th year", "Master"]);
    const langs = ["English", ...rng.sample(LANGS.slice(1), rng.int(1, 3))];
    const submittedDaysAgo = c.key === "current" ? (stage === "received" ? rng.float() * 3 : 3 + rng.float() * 24)
      : c.key === "previous" ? 80 + rng.float() * 28 : 255 + rng.float() * 33;

    // the oldest cycle: most applications are already anonymised by the retention job
    const anonymised = c.key === "old" && stage !== "offer_accepted" && i % 3 !== 0;
    const personId = anonymised ? null : rng.uuid();
    if (personId) {
      add("public.people", { id: personId, first_name: first, last_name: last, email, nationality,
        phone: `+34 6${rng.int(10, 99)} ${rng.int(100, 999)} ${rng.int(100, 999)}`,
        linkedin_url: `https://www.linkedin.com/in/${slugify(first)}-${slugify(last)}-${rng.int(1000, 9999)}`,
        city: "Barcelona", created_at: ago(submittedDaysAgo) });
      add("public.person_roles", { person_id: personId, role: "applicant", start_date: dateAgo(submittedDaysAgo) });
      if (stage === "offer_accepted" && c.key !== "current") {
        add("public.person_roles", { person_id: personId, role: "member", department: track.dept, start_date: dateAgo(submittedDaysAgo - 30) });
      }
    }

    const appId = rng.uuid();
    appCount++;
    const answers: Record<string, string> = {};
    for (const qq of [...COMMON_Q, ...track.extra]) answers[qq.key] = answerFor(qq.key, p.q);

    // fake CV
    let cvFileId: string | null = null;
    if (personId && rng.chance(0.9)) {
      cvFileId = rng.uuid();
      const pdf = makeCvPdf(`${first} ${last}`, `${email}  |  ${nationality}  |  Barcelona`, [
        { title: "Education", lines: [`${uni} - ${program} (${year})`, `Relevant courses: Strategy, Statistics, ${rng.pick(["Impact Investing", "Data Analytics", "Corporate Finance", "Sustainability Management"])}`] },
        { title: "Experience", lines: [`${rng.pick(["Intern", "Analyst intern", "Volunteer", "Project lead"])} - ${rng.pick(["Banco Alimentos BCN", "a fintech start-up", "a family business", "an energy cooperative", "a student consultancy"])}`, answers.impact_experience.slice(0, 95) + (answers.impact_experience.length > 95 ? "..." : "")] },
        { title: "Skills & languages", lines: [`Languages: ${langs.join(", ")}`, `Tools: ${rng.sample(["Excel", "PowerPoint", "Python", "SQL", "Power BI", "Tableau", "R", "Figma"], 4).join(", ")}`] },
        { title: "Links", lines: [`linkedin.com/in/${slugify(first)}-${slugify(last)}`] },
      ]);
      add("public.files", { id: cvFileId, bucket: "applications", path: `${c.slug}/${appId}/cv.pdf`, filename: `CV_${slugify(first)}_${slugify(last)}.pdf`,
        content_type: "application/pdf", size_bytes: pdf.length, storage_backend: "database", created_at: ago(submittedDaysAgo) });
      add("public.file_blobs", { file_id: cvFileId, content: bytea(pdf) });
    }

    // stage path + history
    let path: Stage[];
    if (stage === "rejected") path = reachedInterview ? ["received", "screening", "interview", "rejected"] : ["received", "screening", "rejected"];
    else if (stage === "withdrawn") path = ["received", "screening", "withdrawn"].slice(rng.int(1, 2) === 1 ? 1 : 0) as Stage[];
    else if (stage === "waitlisted") path = ["received", "screening", "interview", "final_review", "waitlisted"];
    else if (stage === "offer_declined") path = ["received", "screening", "interview", "final_review", "offer_sent", "offer_declined"];
    else path = PATH.slice(0, PATH.indexOf(stage) + 1);
    if (path[0] !== "received") path = ["received", ...path];
    let t = submittedDaysAgo;
    const stepGap = c.key === "current" ? Math.max(0.3, (submittedDaysAgo - 0.5) / Math.max(path.length, 1)) : 6;
    const times: number[] = [t];
    for (let k = 1; k < path.length; k++) {
      t = Math.max(0.05, t - stepGap * (0.6 + rng.float() * 0.8));
      times.push(t);
      add("public.status_history", { entity: "application", entity_id: appId, from_status: path[k - 1], to_status: path[k],
        note: path[k] === "rejected" ? (reachedInterview ? rng.pick(REJECT_INTERVIEW) : rng.pick(REJECT_SCREENING)) : null,
        changed_by: rng.pick([uid(2), uid(3)]), changed_at: ago(t) });
    }
    const decided = ["rejected", "waitlisted", "offer_sent", "offer_accepted", "offer_declined"].includes(stage);
    const decisionIdx = path.findIndex((s) => ["rejected", "waitlisted", "offer_sent"].includes(s));
    const decisionReason = stage === "rejected" ? (reachedInterview ? rng.pick(REJECT_INTERVIEW) : rng.pick(REJECT_SCREENING))
      : ["waitlisted"].includes(stage) ? "Strong candidate; waitlisted because all places for the track are filled."
      : ["offer_sent", "offer_accepted", "offer_declined"].includes(stage) ? "Top-quartile written application and convincing case interview." : null;

    add("public.applications", {
      id: appId, cycle_id: cycleId, position_id: positionIds.get(`${c.key}:${track.slug}`)!, person_id: personId, stage,
      alias: `C-${appId.slice(0, 6).toUpperCase()}`,
      answers: json(anonymised ? {} : answers), university: anonymised ? null : uni, degree_program: program, study_year: year,
      languages: anonymised ? [] : langs, heard_from: rng.weighted(HEARD), cv_file_id: cvFileId,
      consent_at: ago(submittedDaysAgo), consent_version: c.key === "current" ? "2026-11" : "2026-02",
      decision_reason: anonymised ? null : decisionReason,
      decided_at: decided && decisionIdx >= 0 ? ago(times[decisionIdx]) : null, decided_by: decided ? uid(2) : null,
      offer_sent_at: path.includes("offer_sent") ? ago(times[path.indexOf("offer_sent")]) : null,
      offer_responded_at: ["offer_accepted", "offer_declined"].includes(stage) ? ago(times[times.length - 1]) : null,
      submitted_at: ago(submittedDaysAgo), stage_changed_at: ago(times[times.length - 1]),
      anonymized_at: anonymised ? ago(60) : null, created_at: ago(submittedDaysAgo),
    });

    // reviewer assignments & scorecards (ground truth: quality + reviewer severity + noise)
    const trackExperts = REVIEWERS.filter((r) => (track.slug === "analytics" ? r.dept === "analytics" || rng.chance(0.4) : r.dept !== "analytics" || rng.chance(0.3)));
    const pool = trackExperts.length >= 2 ? trackExperts : REVIEWERS;
    const reached = (s: Stage) => path.includes(s);
    for (const [revStage, criteria, needStage, doneStage] of [
      ["screening", SCREENING_CRITERIA, "screening", "interview"],
      ["interview", INTERVIEW_CRITERIA, "interview", "final_review"],
    ] as const) {
      if (!reached(needStage)) continue;
      const reviewers = rng.sample(pool, 2);
      const finished = reached(doneStage) || (revStage === "screening" && stage === "rejected" && !reachedInterview)
        || (revStage === "interview" && stage === "rejected" && reachedInterview) || (c.key !== "current");
      reviewers.forEach((r, ri) => {
        add("public.application_reviewers", { application_id: appId, reviewer_id: r.id, stage: revStage, assigned_at: ago(times[1] ?? 1),
          assigned_by: uid(2), due_at: c.key === "current" ? ahead(rng.int(1, 6)) : ago(80), assignment_method: rng.chance(0.7) ? "optimizer" : "manual" });
        const submitted = finished || (rng.chance(0.45) && ri === 0);
        if (!submitted && !rng.chance(0.25)) return;
        const scores: Record<string, number> = {};
        const sev = severity.get(r.id) ?? 0;
        for (const [key] of criteria) scores[key] = Math.round(clamp(p.q + sev + rng.normal(0, 0.55), 1, 5));
        const avg = Object.values(scores).reduce((a, b) => a + b, 0) / criteria.length;
        const recommendation = avg >= 4.2 ? "strong_yes" : avg >= 3.5 ? "yes" : avg >= 2.8 ? "maybe" : "no";
        add("public.reviews", { application_id: appId, reviewer_id: r.id, stage: revStage, scores: json(scores),
          recommendation: submitted ? recommendation : null,
          comment: anonymised ? null : rng.pick([
            "Clear motivation, concrete example of impact. Would like to see more structure in the teamwork answer.",
            "Generic answers; little evidence of impact work.",
            "Very strong analytical profile, good fit for the Analytics track.",
            "Good communicator; impact example is convincing.",
            "Solid but not outstanding. Borderline.",
            "Excellent case structure, calm under pressure.",
          ]),
          submitted_at: submitted ? ago(Math.max(0.05, (times[1] ?? 1) - rng.float())) : null, created_at: ago(times[1] ?? 1) });
      });
    }

    if (c.key === "current" && personId && stage === "interview") {
      const when = rng.chance(0.4) ? -rng.float() * 3 : rng.float() * 9;
      const panel = rng.sample(REVIEWERS, 2).map((r) => r.id);
      add("public.interviews", { application_id: appId, round: 1, scheduled_at: when < 0 ? ago(-when) : ahead(when),
        duration_minutes: 45, format: rng.chance(0.6) ? "in_person" : "online",
        location: rng.chance(0.6) ? "Esade Pedralbes, room 2.13" : "Google Meet", interviewer_ids: raw2uuidArray(panel),
        status: when < 0 ? "done" : "scheduled", created_by: uid(3) });
    }
    if (c.key === "current" && personId && rng.chance(0.12)) {
      add("public.application_comments", { application_id: appId, author_id: rng.pick([uid(2), uid(3)]),
        body: rng.pick(["Asked to move the interview to Thursday - confirmed.", "Also a strong fit for Analytics; consider second track.",
          "Referred by a current member (declared, reviewer reassigned).", "Exchange student, only available until June."]),
        visibility: "hr", created_at: ago(rng.float() * 5) });
    }
    if (personId) {
      add("public.email_outbox", { department: "hr", to_email: email, to_person_id: personId, subject: `We received your application - ${c.name}`,
        body_text: `Hi ${first},\n\nthank you for applying to 180 Degrees Consulting Barcelona (${track.name}). We will get back to you within two weeks.\n\nThe HR team`,
        status: "sent", provider: "demo", sent_at: ago(submittedDaysAgo - 0.01), application_id: appId, created_at: ago(submittedDaysAgo), scheduled_for: ago(submittedDaysAgo) });
    }
  });
}

// declared conflict of interest (demonstrates the optimiser constraint)
// (attached to the first current application reviewed by Clara, see SQL below)

// ---------------------------------------------------------------------------
// Client outreach
// ---------------------------------------------------------------------------
const SECTORS = [["Circular economy", 14], ["Renewable energy", 9], ["Education", 12], ["Health & wellbeing", 9], ["Food & agriculture", 10],
  ["Sustainable mobility", 6], ["Financial inclusion", 6], ["Fashion & textiles", 6], ["Water & oceans", 5], ["Social housing", 5],
  ["Culture & arts", 4], ["Refugees & migration", 6], ["Elderly care", 4], ["Tech for good", 8]] as const;
const CITIES = [["Barcelona", 62], ["Madrid", 9], ["Valencia", 6], ["Girona", 4], ["Sabadell", 3], ["Terrassa", 3], ["Bilbao", 3], ["Sevilla", 3], ["Palma", 3], ["Lisbon", 2], ["Milan", 2]] as const;
const PREFIX = ["Eco", "Circu", "Verd", "Mar", "Sol", "Terra", "Bio", "Agro", "Kids", "Social", "Open", "Bright", "Blau", "Green", "Fair",
  "Re", "Ola", "Nexo", "Vida", "Arrel", "Llum", "Aigua", "Teix", "Cuida", "Mente", "Pan", "Raíz", "Brisa", "Faro", "Nido"];
const SUFFIX = ["lab", "loop", "hub", "works", "tech", "box", "net", "fab", "wise", "path", "cycle", "grid", "seed", "nest", "mind", "link", "verse", "kit"];
const ORG_FORMS: Record<string, (s: string) => string> = {
  startup: (s) => `${s}`,
  social_enterprise: (s) => `${s} Impact`,
  ngo: (s) => rng.pick([`Asociación ${s}`, `${s} Solidari`, `Associació ${s}`]),
  foundation: (s) => rng.pick([`Fundació ${s}`, `Fundación ${s}`]),
  company: (s) => `${s} ${rng.pick(["Group", "Industries", "Partners", "Solutions"])}`,
  public_sector: (s) => `Agència ${s}`,
};
const TITLES: Record<string, string[]> = {
  startup: ["Founder & CEO", "Co-founder & COO", "Co-founder"],
  social_enterprise: ["Founder & CEO", "Managing Director", "Head of Operations"],
  ngo: ["Executive Director", "Programme Manager", "Head of Partnerships"],
  foundation: ["Director", "Head of Programmes", "Partnerships Manager"],
  company: ["Head of Sustainability", "CSR Manager", "Head of Partnerships"],
  public_sector: ["Head of Innovation", "Programme Lead"],
};
const PROJECTS = ["Market entry strategy for a second city", "Impact measurement framework", "Pricing strategy for a new B2B offer",
  "Fundraising & grant strategy", "Volunteer retention analysis", "Go-to-market plan for a new product line", "Customer segmentation",
  "Operational efficiency review", "Digital marketing strategy", "Financial sustainability model"];
const NEXT_STEPS: Record<string, string[]> = {
  new: ["Find decision maker", "Send first e-mail", "Check Esade alumni connection"],
  contacted: ["Follow up if no reply", "Connect on LinkedIn"],
  follow_up: ["Second follow-up", "Try phone call"],
  replied: ["Propose call slots", "Send 180DC deck"],
  meeting: ["Prepare discovery call", "Send scope draft after call"],
  proposal: ["Chase scope feedback", "Agree project start date"],
  on_hold: ["Re-contact in January"],
};

const orgs: { id: string; name: string; type: string; sector: string; city: string; size: string; domain: string }[] = [];
const usedNames = new Set<string>();
for (let i = 0; i < 175; i++) {
  const type = rng.weighted([["startup", 38], ["social_enterprise", 18], ["ngo", 20], ["foundation", 10], ["company", 12], ["public_sector", 2]] as const);
  let base: string;
  do base = `${rng.pick(PREFIX)}${rng.pick(SUFFIX)}`; while (usedNames.has(base));
  usedNames.add(base);
  const name = ORG_FORMS[type](base);
  const domain = `${slugify(base)}.example.com`;
  const sector = rng.weighted(SECTORS);
  const city = rng.weighted(CITIES);
  const size = type === "company" ? rng.pick(["201-1000", "1000+"]) : type === "startup" ? rng.pick(["1-10", "11-50", "11-50", "51-200"]) : rng.pick(["1-10", "11-50", "51-200"]);
  const id = rng.uuid();
  orgs.push({ id, name, type, sector, city, size, domain });
  add("public.organizations", { id, name, type, website: `https://www.${domain}`, domain, sector, size_band: size, city,
    country: ["Lisbon", "Milan"].includes(city) ? (city === "Lisbon" ? "Portugal" : "Italy") : "Spain",
    description: `${name} works on ${sector.toLowerCase()} in ${city}${type === "startup" ? ", founded " + rng.int(2017, 2025) : ""}.`,
    impact_areas: [sector], source: rng.pick(["import", "import", "manual", "ai_research", "referral"]), do_not_contact: i === 7,
    created_at: ago(rng.int(5, 300)), created_by: rng.pick([uid(9), uid(10)]) });
}

const STAGE_MIX = [["new", 32], ["contacted", 30], ["follow_up", 15], ["replied", 12], ["meeting", 8], ["proposal", 6], ["won", 8], ["lost", 6], ["not_interested", 5], ["on_hold", 3]] as const;
const TEMPLATE_IDS: Record<string, string> = {};
const LEADS: { id: string; stage: string; org: (typeof orgs)[number]; contact: string; email: string; owner: string }[] = [];
orgs.forEach((o, i) => {
  const nContacts = o.type === "company" ? rng.int(1, 3) : rng.int(1, 2);
  const contacts: { id: string; email: string; first: string }[] = [];
  for (let k = 0; k < nContacts; k++) {
    const first = rng.pick(FIRST);
    const last = rng.pick(LAST);
    const pid = rng.uuid();
    const email = `${slugify(first)}.${slugify(last)}@${o.domain}`;
    if (usedEmails.has(email)) continue;
    usedEmails.add(email);
    add("public.people", { id: pid, first_name: first, last_name: last, email,
      linkedin_url: `https://www.linkedin.com/in/${slugify(first)}-${slugify(last)}-${rng.int(100, 999)}`, city: o.city, created_at: ago(200),
      do_not_contact: i === 11 && k === 0, created_by: uid(9) });
    add("public.person_roles", { person_id: pid, role: "contact", organization_id: o.id, title: rng.pick(TITLES[o.type]),
      is_esade_alumni: rng.chance(0.2), start_date: dateAgo(300), created_by: uid(9) });
    contacts.push({ id: pid, email, first });
  }
  if (i >= 150 || !contacts.length) return; // some organisations have no lead yet
  const stage = rng.weighted(STAGE_MIX);
  const leadId = rng.uuid();
  const createdDays = rng.int(3, 120);
  const owner = rng.weighted([[uid(9), 55], [uid(10), 45]] as const);
  const due = NEXT_STEPS[stage] ? rng.int(-12, 14) : null;
  add("public.leads", { id: leadId, organization_id: o.id, owner_id: owner, stage, priority: rng.weighted([[1, 25], [2, 55], [3, 20]] as const),
    source: rng.weighted([["import", 40], ["manual", 20], ["ai_research", 12], ["alumni", 14], ["referral", 10], ["inbound", 4]] as const),
    project_idea: rng.chance(0.7) ? rng.pick(PROJECTS) : null,
    next_step: NEXT_STEPS[stage] ? rng.pick(NEXT_STEPS[stage]) : null,
    next_step_due: due === null ? null : due < 0 ? dateAgo(-due) : dateAhead(due),
    lost_reason: stage === "lost" ? rng.pick(["Chose a paid consultancy", "No capacity this semester", "Project scope too small"])
      : stage === "not_interested" ? rng.pick(["Not interested", "Already working with another student club"]) : null,
    handed_over_to: stage === "won" ? rng.pick(["Marc Puig", "Clara Dubois"]) : null,
    stage_changed_at: ago(Math.min(createdDays, rng.int(1, 40))), created_at: ago(createdDays), created_by: owner });
  add("public.lead_contacts", { lead_id: leadId, person_id: contacts[0].id, is_primary: true });
  LEADS.push({ id: leadId, stage, org: o, contact: contacts[0].id, email: contacts[0].email, owner });
});

// templates
const hrTemplates = [
  ["application_received", "Application received", "We received your application - {{cycle}}",
    "Hi {{first_name}},\n\nthank you for applying to 180 Degrees Consulting Barcelona for the {{position}} track. We review every application carefully and will get back to you within two weeks.\n\nBest,\nThe HR team", "received", false],
  ["interview_invitation", "Interview invitation", "Your interview with 180DC Barcelona",
    "Hi {{first_name}},\n\ncongratulations - we would love to meet you for an interview for the {{position}} track. Please pick a slot here: {{scheduling_link}}\n\nThe interview has a short case part; no preparation beyond your usual curiosity is needed.\n\nBest,\n{{sender_name}}", "interview", true],
  ["rejection_screening", "Rejection after screening", "Your application to 180DC Barcelona",
    "Hi {{first_name}},\n\nthank you for your interest in 180 Degrees Consulting Barcelona. After careful review we will not move forward with your application this cycle. We received many strong applications and hope you consider applying again.\n\nBest,\nThe HR team", "rejected", true],
  ["offer", "Offer", "Welcome to 180 Degrees Consulting Barcelona!",
    "Hi {{first_name}},\n\nwe are delighted to offer you a place in the {{position}} track for {{cycle}}. Please confirm by replying to this e-mail within 5 days.\n\nWelcome on board!\n{{sender_name}}", "offer_sent", true],
  ["waitlist", "Waitlist", "Your application to 180DC Barcelona",
    "Hi {{first_name}},\n\nyou were a very strong candidate. All places in the {{position}} track are currently filled, so we have put you on our waitlist and will contact you if a place opens up.\n\nBest,\nThe HR team", "waitlisted", true],
] as const;
for (const [key, name, subject, body, trigger, review] of hrTemplates) {
  const id = rng.uuid();
  TEMPLATE_IDS[key] = id;
  add("public.email_templates", { id, department: "hr", key, variant: "A", name, subject, body, trigger_stage: trigger, requires_review: review, created_by: uid(2) });
}
const crTemplates = [
  ["first_touch", "A", "First touch (A: credentials)", "Pro bono consulting support from Esade students for {{organization}}",
    "Dear {{first_name}},\n\nI am {{sender_name}} from 180 Degrees Consulting Barcelona, the Esade chapter of the world's largest student consultancy. Every term, teams of 5-6 trained students deliver a 10-week consulting project for social enterprises and NGOs - free of charge.\n\nWould {{organization}} be interested in a short call to explore a project?\n\nBest regards,\n{{sender_name}}\n\nIf you prefer not to hear from us again: {{unsubscribe_link}}"],
  ["first_touch", "B", "First touch (B: specific problem)", "Can 6 Esade students help {{organization}} with {{project_idea}}?",
    "Hi {{first_name}},\n\nI came across {{organization}}'s work on {{sector}} and wondered whether a 10-week project on {{project_idea}} could be useful for you. Our consultants work pro bono, coached by experienced alumni.\n\nIf it sounds interesting, would a 20-minute call next week work?\n\nBest,\n{{sender_name}}\n180 Degrees Consulting Barcelona\n\nNot relevant? {{unsubscribe_link}}"],
  ["followup_1", "A", "Follow-up 1", "Re: {{organization}} x 180DC Barcelona",
    "Hi {{first_name}},\n\njust bringing my previous e-mail back to the top of your inbox. Happy to share examples of past projects if helpful.\n\nBest,\n{{sender_name}}\n\n{{unsubscribe_link}}"],
  ["followup_2", "A", "Follow-up 2 (last)", "Last note from 180DC Barcelona",
    "Hi {{first_name}},\n\nI don't want to fill your inbox, so this will be my last note. If a pro bono project becomes relevant later, just reply to this e-mail.\n\nAll the best,\n{{sender_name}}\n\n{{unsubscribe_link}}"],
] as const;
for (const [key, variant, name, subject, body] of crTemplates) {
  const id = rng.uuid();
  TEMPLATE_IDS[`${key}_${variant}`] = id;
  add("public.email_templates", { id, department: "client_relations", key, variant, name, subject, body, requires_review: false, created_by: uid(9) });
}
const SEQUENCE_ID = rng.uuid();
add("public.email_sequences", { id: SEQUENCE_ID, name: "Standard cold outreach", department: "client_relations",
  steps: json([{ after_days: 5, template_key: "followup_1" }, { after_days: 12, template_key: "followup_2" }]) });

// outreach history: first touch A/B (true reply rates 13% vs 24%), replies, calls
const STAGES_AFTER_CONTACT = new Set(["contacted", "follow_up", "replied", "meeting", "proposal", "won", "lost", "not_interested", "on_hold"]);
const REPLIED = new Set(["replied", "meeting", "proposal", "won", "lost", "not_interested", "on_hold"]);
for (const l of LEADS) {
  if (!STAGES_AFTER_CONTACT.has(l.stage)) continue;
  const variant = rng.chance(0.5) ? "A" : "B";
  const sentDays = rng.int(8, 90);
  const outboxId = rng.uuid();
  add("public.email_outbox", { id: outboxId, department: "client_relations", template_id: TEMPLATE_IDS[`first_touch_${variant}`], template_variant: variant,
    to_email: l.email, to_person_id: l.contact, from_user_id: l.owner, subject: `180DC Barcelona x ${l.org.name}`,
    body_text: `(first-touch e-mail, variant ${variant})`, status: "sent", provider: "demo", sent_at: ago(sentDays), lead_id: l.id,
    campaign: "Autumn outreach", created_at: ago(sentDays), scheduled_for: ago(sentDays), created_by: l.owner });
  add("public.interactions", { organization_id: l.org.id, lead_id: l.id, person_id: l.contact, type: "email_out", occurred_at: ago(sentDays),
    subject: `180DC Barcelona x ${l.org.name}`, summary: `First-touch e-mail (variant ${variant})`, email_outbox_id: outboxId,
    template_id: TEMPLATE_IDS[`first_touch_${variant}`], template_variant: variant, created_by: l.owner });
  // more replies for variant B: this is the "true" effect the A/B analysis should detect
  const replied = REPLIED.has(l.stage) || (l.stage === "follow_up" && rng.chance(variant === "B" ? 0.08 : 0.03));
  if (replied) {
    const replyDays = Math.max(1, sentDays - rng.int(1, 6));
    add("public.interactions", { organization_id: l.org.id, lead_id: l.id, person_id: l.contact, type: "email_in", occurred_at: ago(replyDays),
      subject: `Re: 180DC Barcelona x ${l.org.name}`, summary: rng.pick(["Interested, asks for a call.", "Wants to know more about timing.",
        "Forwarded to the right person.", "Not now, maybe next year."]), created_by: l.owner });
    if (["meeting", "proposal", "won", "lost"].includes(l.stage)) {
      add("public.interactions", { organization_id: l.org.id, lead_id: l.id, person_id: l.contact, type: rng.chance(0.7) ? "meeting" : "call",
        occurred_at: ago(Math.max(0.5, replyDays - rng.int(1, 5))), subject: "Discovery call", summary: "Discussed goals, data availability and timeline.",
        created_by: l.owner });
    }
  } else if (l.stage === "follow_up") {
    add("public.interactions", { organization_id: l.org.id, lead_id: l.id, person_id: l.contact, type: "email_out", occurred_at: ago(Math.max(1, sentDays - 5)),
      subject: `Re: ${l.org.name} x 180DC Barcelona`, summary: "Follow-up 1", template_id: TEMPLATE_IDS.followup_1_A, template_variant: "A", created_by: l.owner });
  }
  if (l.stage === "contacted") {
    add("public.sequence_enrollments", { sequence_id: SEQUENCE_ID, lead_id: l.id, person_id: l.contact, step_index: 0,
      next_run_at: rng.chance(0.5) ? ahead(rng.int(1, 5)) : ago(rng.int(0, 2)), status: "active", enrolled_by: l.owner });
  }
}
// extra sent-but-unanswered first touches to give the A/B test enough volume
for (let k = 0; k < 40; k++) {
  const variant = k % 2 === 0 ? "A" : "B";
  const o = orgs[150 + (k % 25)];
  add("public.email_outbox", { department: "client_relations", template_id: TEMPLATE_IDS[`first_touch_${variant}`], template_variant: variant,
    to_email: `info@${o.domain}`, subject: `180DC Barcelona x ${o.name}`, body_text: "(first-touch e-mail)", status: "sent", provider: "demo",
    sent_at: ago(rng.int(10, 120)), campaign: "Spring outreach (archived)", created_at: ago(120), scheduled_for: ago(120), created_by: uid(9) });
}

add("public.icp_profiles", { name: "Impact organisations in Catalonia", is_active: true, created_by: uid(9), criteria: json({
  sectors: { "Circular economy": 1, "Renewable energy": 0.9, Education: 0.9, "Refugees & migration": 1, "Financial inclusion": 0.9,
    "Food & agriculture": 0.8, "Health & wellbeing": 0.8, "Tech for good": 0.8, "Water & oceans": 0.8, "Social housing": 0.9,
    "Fashion & textiles": 0.7, "Sustainable mobility": 0.7, "Elderly care": 0.8, "Culture & arts": 0.5 },
  org_types: { startup: 0.9, social_enterprise: 1, ngo: 1, foundation: 0.8, company: 0.5, public_sector: 0.4, university: 0.3, other: 0.3 },
  size_bands: { "1-10": 0.8, "11-50": 1, "51-200": 0.9, "201-1000": 0.6, "1000+": 0.4 },
  cities: { Barcelona: 1, Girona: 0.8, Sabadell: 0.8, Terrassa: 0.8, Madrid: 0.6, Valencia: 0.6 },
  weights: { sector: 0.35, org_type: 0.25, size: 0.15, location: 0.15, alumni: 0.1 },
}) });

for (const e of ["no-thanks@" + orgs[3].domain, "privacy@" + orgs[19].domain]) {
  add("public.email_suppressions", { email: e, reason: "unsubscribe", source: "unsubscribe link", created_at: ago(rng.int(5, 40)) });
}

const AI_RUN = rng.uuid();
add("public.ai_runs", { id: AI_RUN, kind: "lead_research", status: "succeeded", model: "demo-offline",
  input_summary: "Social enterprises in circular fashion and food waste, Barcelona, 11-200 employees",
  output: json({ suggestions: 4 }), input_tokens: 0, output_tokens: 0, cost_usd: 0, created_by: uid(9), created_at: ago(1), finished_at: ago(1) });
for (const [name, sector, city, why] of [
  ["Reteixit", "Fashion & textiles", "Barcelona", "Upcycling workshop employing people at risk of exclusion; expanding to B2B and needs a pricing model."],
  ["Taula Plena", "Food & agriculture", "Barcelona", "Redistributes surplus food from markets; growing fast and looking for an impact measurement framework."],
  ["Bicicircular", "Sustainable mobility", "Sabadell", "Refurbishes donated bikes with young apprentices; considering a second workshop location."],
  ["Llavor Verda", "Education", "Girona", "Environmental education NGO for primary schools; fundraising mix heavily dependent on one grant."],
] as const) {
  add("public.lead_suggestions", { ai_run_id: AI_RUN, name, website: `https://www.${slugify(name)}.example.com`, domain: `${slugify(name)}.example.com`,
    org_type: "social_enterprise", sector, city, rationale: why, sources: json([`https://www.${slugify(name)}.example.com/about`]),
    suggested_contact_role: "Founder / Managing Director", fit_score: rng.int(68, 92), status: "pending" });
}

add("public.settings", { key: "organization", value: json({ name: "180 Degrees Consulting Barcelona", short_name: "180DC Barcelona" }),
  description: "Name used in e-mails and on the public form" });
add("public.settings", { key: "email", value: json({ daily_limit_per_sender: 80, min_seconds_between: 20, from_name: "180 Degrees Consulting Barcelona" }),
  description: "Sending limits protect deliverability of members' mailboxes" });

// ---------------------------------------------------------------------------
// write
// ---------------------------------------------------------------------------
const ORDER = ["public.settings", "public.people", "public.app_users", "public.user_roles", "public.organizations", "public.person_roles", "public.rubrics",
  "public.rubric_criteria", "public.recruitment_cycles", "public.positions", "public.reviewer_pool", "public.files", "public.file_blobs",
  "public.applications", "public.status_history", "public.application_reviewers", "public.reviews", "public.interviews",
  "public.application_comments", "public.leads", "public.lead_contacts", "public.email_templates",
  "public.email_sequences", "public.email_outbox", "public.interactions", "public.sequence_enrollments", "public.icp_profiles",
  "public.email_suppressions", "public.ai_runs", "public.lead_suggestions"];
const missing = Object.keys(T).filter((t) => !ORDER.includes(t));
if (missing.length) throw new Error(`Tables missing from ORDER: ${missing.join(", ")}`);

const header = `-- GENERATED by scripts/seed/generate.ts - do not edit by hand.
-- Fictional demo data only (reserved example domains). ${appCount} applications, ${orgs.length} organisations.
`;
const footer = `
-- a declared conflict of interest for the optimiser demo
INSERT INTO public.review_conflicts (reviewer_id, application_id, reason)
SELECT '${uid(7)}', a.id, 'Flatmate of the applicant'
FROM public.applications a JOIN public.recruitment_cycles c ON c.id = a.cycle_id
WHERE c.slug = 'spring-2027' AND a.stage = 'received' ORDER BY a.submitted_at LIMIT 1;
-- make last activity consistent with the generated history
UPDATE public.leads l SET last_activity_at = s.last FROM (
  SELECT lead_id, max(occurred_at) AS last FROM public.interactions WHERE lead_id IS NOT NULL GROUP BY lead_id) s
WHERE s.lead_id = l.id;
`;
const body = ORDER.filter((t) => T[t]).map((t) => insert(t, T[t])).join("\n");
writeFileSync(OUT, header + body + footer);
console.log(`✓ wrote ${path.relative(process.cwd(), OUT)}: ${Object.entries(T).map(([k, v]) => `${k.replace("public.", "")}=${v.length}`).join(", ")}`);
