# Design decisions

Short records of the choices that shape the code, with the alternative that was rejected.

### 1. Security in the database, not only in the UI
Row-level security on every table; the app connects with `SET ROLE authenticated` plus JWT claims for each request.
*Rejected:* checks only in page code - one forgotten `where` clause would leak applications to outreach members.
*Cost:* every query runs in a short transaction; policies must be tested (`tests/db`).

### 2. Supabase-compatible migrations, runnable on plain PostgreSQL
SQL files in `supabase/migrations` (Supabase CLI layout and version table) plus a local shim for `auth.uid()` and the
Supabase roles. *Why:* local development and CI need no Docker or Supabase CLI; production stays standard Supabase.

### 3. Stage changes only through database functions
`app.move_application` / `app.move_lead` validate the transition, require reasons and write the history atomically.
*Rejected:* updating the `stage` column from the UI - the board, the dropdown and the decision buttons would each need to
repeat the rules, and the history could be skipped.

### 4. Outbox for every e-mail
Sending only writes a row; a worker sends, retries and throttles. *Why:* bulk campaigns must not hit provider limits,
nothing is lost when the provider is down, every e-mail is auditable, opt-outs can cancel queued mail.

### 5. Transparent models over black boxes
Lead scoring = an explicit ideal client profile + rates learned from history; calibration = a two-way additive model.
*Rejected:* gradient boosting or similar - with a few hundred leads per year it would overfit, and members must be able to
understand and challenge a score.

### 6. Bayesian A/B testing
Posterior probabilities and expected loss instead of p-values: valid at any time the team looks, and answers the actual
question ("how likely is B better, and what do we risk by switching?").

### 7. Integer programming for reviewer assignment
The assignment has hard constraints (conflicts, capacity) and a fairness goal; an ILP finds the optimum in milliseconds at
our size. A greedy fallback keeps the feature working if the solver cannot load.

### 8. AI assists, people decide
AI extracts CV facts, drafts e-mails and proposes leads with sources; nothing is sent, accepted or decided without a
person. Mock mode keeps every AI feature usable offline and in tests.

### 9. Demo personas instead of real accounts for the demo
A public demo with Google sign-in would need real accounts; personas with fictional data let anyone explore every role.
Production switches to Google Workspace sign-in with one environment variable.
