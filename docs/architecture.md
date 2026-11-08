# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, server components, server actions), React 19, Tailwind 4 | one deployable, no separate API to secure |
| Hosting | Vercel (functions in `fra1`), Vercel Cron | zero-ops, preview deployments per pull request |
| Database | PostgreSQL 16 on Supabase (EU) | relational data, row-level security, SQL analytics |
| Auth | Supabase Auth with Google Workspace (demo personas for the public demo) | members already have Workspace accounts |
| Files | Supabase Storage, private bucket; CVs only via an access-checked route | |
| E-mail | Resend through an outbox table | retries, throttling, audit, unsubscribe |
| AI | Claude API (structured outputs, web search, PDF input) | CV facts, lead research, e-mail drafts |
| Optimisation | HiGHS (WASM) | reviewer assignment ILP |

## Security model

The browser never talks to the database. Every query runs on the server in a transaction that first does

```sql
select set_config('request.jwt.claims', '{"sub": "<user id>", "role": "authenticated"}', true);
set local role authenticated;
```

so the **row-level security policies apply to every query** - exactly as Supabase's own API gateway would. A bug in a page
therefore cannot leak data the user's role may not see. `withService()` (role `service_role`) is used only for the public
application form, cron jobs and unsubscribe links.

Role checks live in SQL (`app.is_hr()`, `app.is_outreach()`, … - admin implies every role). Some rules are enforced only
through `SECURITY DEFINER` functions:

- `app.move_application` / `app.move_lead` - the only way to change a stage: checks the role and the allowed
  transition, requires a reason for rejections, offers and lost leads, and writes the history in the same transaction
- `app.my_review_assignments()` - the only door for reviewers: returns their assignments with name and university
  masked during blind screening
- `status_history` and `audit_log` cannot be written directly (`INSERT/UPDATE/DELETE` revoked); `app.log_event` takes
  the actor from the JWT, so it cannot be faked

`tests/db/rls.test.ts` checks these guarantees for every role.

## Code map

```
app/(hub)/hr, reviews, outreach, admin   pages (server components) per area
app/apply, unsubscribe, privacy           public pages
app/api/cron, health, files, ...          route handlers
lib/db                                    withUser / withService
lib/auth                                  demo sessions, Supabase auth, role helpers
lib/hr, lib/outreach, lib/admin           server actions + queries per area
lib/analytics, lib/outreach/*.ts          pure, unit-tested analytics
lib/email                                 templates, outbox, unsubscribe
lib/ai                                    Claude calls (mock / live), cost logging
lib/jobs                                  daily job, retention, cron auth
supabase/migrations                       schema, functions, RLS, views (Supabase CLI compatible)
supabase/local                            shim that makes the migrations run on plain PostgreSQL
scripts/db.ts, scripts/seed               migrate / reset / seed, demo data generator
tests/unit, tests/db, tests/e2e           vitest, vitest against Postgres, Playwright
```

## Background work

| What | Where | When |
| --- | --- | --- |
| send queued e-mails | `processOutbox()` | right after a send (`after()`), every 15 min (`/api/cron/outbox`), daily |
| follow-up sequences | `runSequences()` | every 15 min and daily |
| GDPR retention | `runRetention()` | daily 06:00 UTC |
| lead scores | `recomputeScores()` | daily, after imports and profile changes, on demand |

Rows are claimed with `FOR UPDATE SKIP LOCKED`, so overlapping runs never send twice.

## Data model (main tables)

- `people` - one row per human (applicant, member, client contact), unique by e-mail; `person_roles` records who was what
  and when (applicant → member → alumni, contact at an organisation)
- `app_users` + `user_roles` - who can sign in, with which access roles
- HR: `recruitment_cycles`, `positions`, `rubrics`, `rubric_criteria`, `applications`, `application_reviewers`, `reviews`,
  `review_conflicts`, `application_comments`, `interviews`
- Outreach: `organizations`, `leads` (one open lead per organisation), `lead_contacts`, `interactions`, `lead_scores`,
  `icp_profiles`, `prospect_imports`, `prospect_import_rows`, `lead_suggestions`
- E-mail: `email_templates` (A/B variants), `email_outbox`, `email_suppressions`, `email_sequences`, `sequence_enrollments`
- Cross-cutting: `files`, `status_history`, `audit_log`, `ai_runs`, `settings`
