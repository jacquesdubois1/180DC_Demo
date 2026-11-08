<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 180DC Hub - project rules

Internal tool of 180 Degrees Consulting Barcelona (recruitment + client outreach). Read `README.md`, then
`docs/architecture.md` before changing data access, and `docs/analytics.md` before touching a model.

## Data and privacy

- Fictional data only in this repository, seeds, tests and screenshots (`example.com/.org/.net` domains, invented names).
- Never query the database from client components. Server code uses `withUser(user.id, …)` from `lib/db` so row-level
  security applies; `withService` only for the public form, cron jobs and unsubscribe links - and say why in a comment.
- Stage changes go through `app.move_application` / `app.move_lead`, never `update … set stage`.
- `status_history` and `audit_log` are append-only; log sensitive actions with `app.log_event`.
- Every outgoing e-mail goes through `queueEmail` (suppression check, outbox, audit). Outreach e-mails need
  `{{unsubscribe_link}}`.

## Schema changes

- Add a new file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`; never edit a migration that has reached a shared
  database. New tables need RLS enabled and policies in the same migration.
- `npm run db:reset` locally, then `npm run test:db`. If the seed must change, edit `scripts/seed/*` and run
  `npm run db:seed:generate` - never edit `supabase/seed.sql` by hand.

## Code

- Server actions return `ActionResult` (`{ ok, data?, message? } | { ok: false, error }`), validate input with zod and map
  database errors with `dbErrorMessage`.
- Analytics stay pure functions in `lib/analytics` / `lib/outreach/*.ts` with unit tests on data with a known truth.
- Charts use the validated series colours (`--series-1..3`) from `app/globals.css`; text never takes a series colour.
- Before committing: `npm run lint`, `npm run typecheck`, `npm test` (and `npm run test:db` / `npm run test:e2e` when
  touching SQL or flows).
