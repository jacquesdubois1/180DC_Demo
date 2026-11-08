/**
 * Reviewer assignment as an integer linear program (solved with HiGHS, compiled to WASM).
 *
 * Decision:   x[a,r] = 1 if reviewer r reviews application a
 * Constraints
 *   coverage    each application gets the required number of reviewers (soft: shortage s[a])
 *   capacity    no reviewer exceeds max_reviews (incl. reviews they already have)
 *   conflicts   declared conflicts of interest are never assigned (variable not created)
 *   seniority   at least one senior reviewer per application (soft: t[a])
 *   fairness    L >= relative load of every reviewer; L is minimised (balanced workload)
 * Objective (minimise)
 *   1000 * shortages + 5 * missing seniors + 20 * L - expertise matches - small diversity term
 *
 * A greedy fallback produces a feasible (not necessarily optimal) plan if the solver is unavailable.
 */

export interface AssignApp {
  id: string;
  positionId: string;
  needed: number; // reviewers still missing for this stage
  alreadyAssigned: string[];
}
export interface AssignReviewer {
  id: string;
  capacity: number; // max_reviews
  currentLoad: number; // reviews already assigned in this cycle
  expertise: string[]; // position ids
  senior: boolean;
}
export interface AssignInput {
  apps: AssignApp[];
  reviewers: AssignReviewer[];
  conflicts: { reviewerId: string; applicationId: string }[];
  requireSenior: boolean;
}
export interface AssignResult {
  method: "ilp" | "greedy";
  status: string;
  pairs: { applicationId: string; reviewerId: string; expertiseMatch: boolean }[];
  shortages: { applicationId: string; missing: number }[];
  loads: { reviewerId: string; before: number; after: number; capacity: number }[];
  expertiseMatchRate: number;
  maxRelativeLoad: number;
  solveMs: number;
}

type HighsSolver = { solve: (lp: string, opts?: Record<string, unknown>) => HighsSolution };
type HighsSolution = { Status: string; Columns: Record<string, { Primal: number }> };

let solverPromise: Promise<HighsSolver> | null = null;
async function loadSolver(): Promise<HighsSolver> {
  if (!solverPromise) {
    solverPromise = (async () => {
      const path = await import("node:path");
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(process.cwd(), "package.json"));
      const factory = req("highs") as (o: { locateFile: (f: string) => string }) => Promise<HighsSolver>;
      const dir = path.dirname(req.resolve("highs"));
      return factory({ locateFile: (f: string) => path.join(dir, f) });
    })();
  }
  return solverPromise;
}

export async function optimizeAssignment(input: AssignInput): Promise<AssignResult> {
  const t0 = Date.now();
  try {
    const solver = await loadSolver();
    return { ...solveIlp(input, solver), solveMs: Date.now() - t0 };
  } catch (err) {
    console.warn("HiGHS unavailable, falling back to greedy assignment:", (err as Error).message);
    return { ...greedy(input), solveMs: Date.now() - t0 };
  }
}

function allowedPairs(input: AssignInput) {
  const conflict = new Set(input.conflicts.map((c) => `${c.applicationId}|${c.reviewerId}`));
  const pairs: { a: number; r: number; w: number }[] = [];
  input.apps.forEach((app, a) => {
    if (app.needed <= 0) return;
    input.reviewers.forEach((rev, r) => {
      if (rev.capacity - rev.currentLoad <= 0 && rev.capacity > 0) return;
      if (rev.capacity <= 0) return;
      if (app.alreadyAssigned.includes(rev.id)) return;
      if (conflict.has(`${app.id}|${rev.id}`)) return;
      const match = rev.expertise.includes(app.positionId) ? 1 : 0;
      // tiny deterministic jitter breaks ties without always picking the same reviewer
      const jitter = (((a * 31 + r * 17) % 13) / 13) * 0.01;
      pairs.push({ a, r, w: match + jitter });
    });
  });
  return pairs;
}

function solveIlp(input: AssignInput, solver: HighsSolver): Omit<AssignResult, "solveMs"> {
  const pairs = allowedPairs(input);
  const name = (p: { a: number; r: number }) => `x_${p.a}_${p.r}`;
  const obj: string[] = [];
  const cons: string[] = [];
  const bounds: string[] = ["L >= 0"];
  const binaries: string[] = [];
  pairs.forEach((p) => {
    obj.push(`- ${p.w.toFixed(4)} ${name(p)}`);
    binaries.push(name(p));
  });
  const anySenior = input.reviewers.some((r) => r.senior);
  input.apps.forEach((app, a) => {
    if (app.needed <= 0) return;
    const vars = pairs.filter((p) => p.a === a).map(name);
    obj.push(`+ 1000 s_${a}`);
    bounds.push(`0 <= s_${a} <= ${app.needed}`);
    cons.push(` need_${a}: ${vars.length ? vars.join(" + ") + " + " : ""}s_${a} = ${app.needed}`);
    const alreadySenior = app.alreadyAssigned.some((id) => input.reviewers.find((r) => r.id === id)?.senior);
    if (input.requireSenior && anySenior && !alreadySenior) {
      const sv = pairs.filter((p) => p.a === a && input.reviewers[p.r].senior).map(name);
      obj.push(`+ 5 t_${a}`);
      bounds.push(`0 <= t_${a} <= 1`);
      cons.push(` senior_${a}: ${sv.length ? sv.join(" + ") + " + " : ""}t_${a} >= 1`);
    }
  });
  obj.push("+ 20 L");
  input.reviewers.forEach((rev, r) => {
    const vars = pairs.filter((p) => p.r === r).map(name);
    if (!vars.length) return;
    cons.push(` cap_${r}: ${vars.join(" + ")} <= ${Math.max(0, rev.capacity - rev.currentLoad)}`);
    // (current + sum x) / capacity <= L   <=>   sum x - capacity * L <= -current
    cons.push(` bal_${r}: ${vars.join(" + ")} - ${rev.capacity} L <= ${-rev.currentLoad}`);
  });
  const lp = ["Minimize", ` obj: ${obj.join(" ").replace(/^\+ /, "")}`, "Subject To", ...cons, "Bounds", ...bounds.map((b) => ` ${b}`),
    "Binary", ...binaries.map((b) => ` ${b}`), "End"].join("\n");
  const sol = solver.solve(lp, { time_limit: 20, mip_rel_gap: 0.001 });
  if (!["Optimal", "Time limit reached"].includes(sol.Status)) throw new Error(`Solver status ${sol.Status}`);
  const chosen = pairs.filter((p) => (sol.Columns[name(p)]?.Primal ?? 0) > 0.5);
  return summarize(input, chosen, "ilp", sol.Status);
}

function greedy(input: AssignInput): Omit<AssignResult, "solveMs"> {
  const pairs = allowedPairs(input);
  const load = input.reviewers.map((r) => r.currentLoad);
  const chosen: typeof pairs = [];
  // hardest applications first (fewest eligible reviewers)
  const order = input.apps.map((_, a) => a).sort((x, y) => pairs.filter((p) => p.a === x).length - pairs.filter((p) => p.a === y).length);
  for (const a of order) {
    let need = input.apps[a].needed;
    const cands = pairs.filter((p) => p.a === a)
      .sort((p, q) => load[p.r] / input.reviewers[p.r].capacity - load[q.r] / input.reviewers[q.r].capacity || q.w - p.w);
    for (const p of cands) {
      if (need <= 0) break;
      if (load[p.r] >= input.reviewers[p.r].capacity) continue;
      chosen.push(p);
      load[p.r]++;
      need--;
    }
  }
  return summarize(input, chosen, "greedy", "Heuristic");
}

function summarize(input: AssignInput, chosen: { a: number; r: number; w: number }[], method: "ilp" | "greedy", status: string): Omit<AssignResult, "solveMs"> {
  const pairs = chosen.map((p) => ({
    applicationId: input.apps[p.a].id,
    reviewerId: input.reviewers[p.r].id,
    expertiseMatch: input.reviewers[p.r].expertise.includes(input.apps[p.a].positionId),
  }));
  const added = new Map<string, number>();
  for (const p of pairs) added.set(p.reviewerId, (added.get(p.reviewerId) ?? 0) + 1);
  const loads = input.reviewers.map((r) => ({ reviewerId: r.id, before: r.currentLoad, after: r.currentLoad + (added.get(r.id) ?? 0), capacity: r.capacity }));
  const perApp = new Map<string, number>();
  for (const p of pairs) perApp.set(p.applicationId, (perApp.get(p.applicationId) ?? 0) + 1);
  const shortages = input.apps
    .map((a) => ({ applicationId: a.id, missing: Math.max(0, a.needed - (perApp.get(a.id) ?? 0)) }))
    .filter((s) => s.missing > 0);
  return {
    method,
    status,
    pairs,
    shortages,
    loads,
    expertiseMatchRate: pairs.length ? pairs.filter((p) => p.expertiseMatch).length / pairs.length : 0,
    maxRelativeLoad: Math.max(0, ...loads.filter((l) => l.capacity > 0).map((l) => l.after / l.capacity)),
  };
}
