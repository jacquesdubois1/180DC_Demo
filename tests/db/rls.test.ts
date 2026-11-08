/**
 * Row-level security and database invariants, tested the way the app uses the database:
 * every query runs as role `authenticated` with the user's JWT claims (or as `anon`).
 * Needs a migrated and seeded database: `npm run db:reset`, then `npm run test:db`.
 * Every test runs in a transaction that is rolled back, so the data is never changed.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:54322/postgres", {
  max: 2, onnotice: () => {}, prepare: false,
});
afterAll(() => sql.end());

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { admin: uid(1), hr: uid(2), interviewer: uid(4), outreach: uid(9), member: uid(11) };

class Rollback extends Error {}

/** Run fn as a signed-in user (or anonymously) inside a transaction that is always rolled back. */
async function as<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      const claims = userId ? { sub: userId, role: "authenticated" } : { role: "anon" };
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.unsafe(`set local role ${userId ? "authenticated" : "anon"}`);
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return result as T;
}
const count = async (tx: postgres.TransactionSql, table: string) => (await tx.unsafe(`select count(*)::int as n from ${table}`))[0].n as number;

describe("who sees what (row-level security)", () => {
  it("HR sees applications but no outreach data", async () => {
    await as(U.hr, async (tx) => {
      expect(await count(tx, "applications")).toBeGreaterThan(200);
      expect(await count(tx, "leads")).toBe(0);
      expect(await count(tx, "email_templates where department = 'client_relations'")).toBe(0);
      expect(await count(tx, "audit_log")).toBe(0);
    });
  });

  it("Client Relations sees leads and contacts, but no applications or applicants", async () => {
    await as(U.outreach, async (tx) => {
      expect(await count(tx, "leads")).toBeGreaterThan(100);
      expect(await count(tx, "applications")).toBe(0);
      expect(await count(tx, "reviews")).toBe(0);
      expect(await count(tx, "people p where exists (select 1 from person_roles r where r.person_id = p.id and r.role = 'applicant')")).toBe(0);
    });
  });

  it("an interviewer cannot read applications directly - only blinded assignments", async () => {
    await as(U.interviewer, async (tx) => {
      expect(await count(tx, "applications")).toBe(0);
      expect(await count(tx, "people")).toBeLessThanOrEqual(1); // at most their own profile
      const rows = await tx<{ is_blind: boolean; candidate_name: string | null; university: string | null }[]>`select * from app.my_review_assignments()`;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows.filter((x) => x.is_blind)) {
        expect(r.candidate_name).toBeNull();
        expect(r.university).toBeNull();
      }
    });
  });

  it("reviewers only see colleagues' scores after submitting their own (no anchoring)", async () => {
    await as(U.interviewer, async (tx) => {
      const leaks = await tx`
        select r.id from reviews r
        where r.reviewer_id <> ${U.interviewer}
          and not exists (select 1 from reviews mine where mine.application_id = r.application_id and mine.stage = r.stage
                          and mine.reviewer_id = ${U.interviewer} and mine.submitted_at is not null)`;
      expect(leaks.length).toBe(0);
    });
  });

  it("a plain member sees no personal data, and anonymous visitors see nothing at all", async () => {
    await as(U.member, async (tx) => {
      expect(await count(tx, "applications")).toBe(0);
      expect(await count(tx, "leads")).toBe(0);
      expect(await count(tx, "email_outbox")).toBe(0);
    });
    await expect(as(null, (tx) => tx`select count(*) from applications`)).rejects.toMatchObject({ code: "42501" });
  });

  it("everyone can write audit events through app.log_event, only admins can read them", async () => {
    await as(U.outreach, async (tx) => {
      await tx`select app.log_event('test.event', 'system', null, '{}'::jsonb)`;
      expect(await count(tx, "audit_log")).toBe(0);
    });
    await as(U.admin, async (tx) => {
      await tx`select app.log_event('test.event', 'system', null, '{}'::jsonb)`;
      const [row] = await tx<{ actor_id: string }[]>`select actor_id from audit_log where action = 'test.event' order by id desc limit 1`;
      expect(row.actor_id).toBe(U.admin); // the actor comes from the JWT, it cannot be faked by the caller
    });
  });
});

describe("history cannot be rewritten", () => {
  it("nobody can write the stage history or audit log directly - only through the stage functions", async () => {
    await expect(as(U.hr, (tx) => tx`insert into status_history (entity, entity_id, to_status) values ('application', gen_random_uuid(), 'offer_sent')`))
      .rejects.toMatchObject({ code: "42501" });
    await expect(as(U.admin, (tx) => tx`delete from audit_log`)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("business rules live in the database", () => {
  it("rejects stage jumps and rejections without a reason", async () => {
    const [app] = await sql<{ id: string }[]>`select id from applications where stage = 'received' and anonymized_at is null limit 1`;
    await expect(as(U.hr, (tx) => tx`select app.move_application(${app.id}, 'offer_sent')`)).rejects.toMatchObject({ code: "22023" });
    await expect(as(U.hr, (tx) => tx`select app.move_application(${app.id}, 'rejected')`)).rejects.toMatchObject({ code: "22023" });
    await as(U.hr, async (tx) => {
      await tx`select app.move_application(${app.id}, 'screening')`;
      const [h] = await tx<{ to_status: string; changed_by: string }[]>`
        select to_status, changed_by from status_history where entity = 'application' and entity_id = ${app.id} order by id desc limit 1`;
      expect(h).toMatchObject({ to_status: "screening", changed_by: U.hr });
    });
  });

  it("only Client Relations can move leads, and closing a lead needs a reason", async () => {
    const [lead] = await sql<{ id: string }[]>`select id from leads where stage = 'contacted' limit 1`;
    await expect(as(U.hr, (tx) => tx`select app.move_lead(${lead.id}, 'replied')`)).rejects.toMatchObject({ code: "42501" });
    await expect(as(U.outreach, (tx) => tx`select app.move_lead(${lead.id}, 'lost')`)).rejects.toMatchObject({ code: "22023" });
    await as(U.outreach, async (tx) => {
      await tx`select app.move_lead(${lead.id}, 'lost', 'No budget this year')`;
      const [l] = await tx<{ stage: string; lost_reason: string }[]>`select stage::text, lost_reason from leads where id = ${lead.id}`;
      expect(l).toEqual({ stage: "lost", lost_reason: "No budget this year" });
    });
  });

  it("an organisation has at most one open lead", async () => {
    const [lead] = await sql<{ organization_id: string }[]>`select organization_id from leads where stage = 'new' limit 1`;
    await expect(as(U.outreach, (tx) => tx`insert into leads (organization_id) values (${lead.organization_id})`)).rejects.toMatchObject({ code: "23505" });
  });

  it("suppressed and opted-out addresses are never e-mailed", async () => {
    const [s] = await sql<{ email: string }[]>`select email::text from email_suppressions where email is not null limit 1`;
    await as(U.outreach, async (tx) => {
      const [{ blocked }] = await tx<{ blocked: boolean }[]>`select app.is_suppressed(${s.email}) as blocked`;
      expect(blocked).toBe(true);
      const [{ free }] = await tx<{ free: boolean }[]>`select not app.is_suppressed('someone.new@impact.example.org') as free`;
      expect(free).toBe(true);
    });
  });
});
