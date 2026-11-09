# Deployment: Vercel + Supabase

Two stages. Start with **stage 1** - a public demo with fictional data and persona sign-in. Move to **stage 2** only
when the board has agreed to put real applicant and client data into the tool.

Keep demo and production in **separate Supabase projects**. Never load the demo seed into the production database, and
never import real people into the demo.

---

## Stage 1 - demo deployment

### 1. Database (Supabase via the Vercel Marketplace)

1. Vercel dashboard → your team → **Storage** (or Marketplace) → **Supabase** → *Create*.
2. Region: **Frankfurt (eu-central-1)** or another EU region - the data is personal data of EU residents.
3. Connect the new Supabase project to the Vercel project `180dc_demo` (create the Vercel project first by importing the
   GitHub repository if it does not exist yet).

The integration adds environment variables to the Vercel project automatically (`POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, …).
The Hub reads those names directly - nothing to copy. (Without the Marketplace: set `DATABASE_URL` to the *transaction
pooler* string, port 6543, and `DATABASE_URL_DIRECT` to the *session/direct* string, port 5432.)

### 2. Schema and demo data

**Without a local setup (browser only):**

1. Vercel → Project → Settings → Environment Variables → copy the value of `POSTGRES_URL_NON_POOLING`.
2. GitHub → repository → Settings → Secrets and variables → Actions → *New repository secret*:
   name `DEMO_DATABASE_URL`, value = the copied connection string.
3. GitHub → Actions → **Set up demo database** → *Run workflow*, type `demo`, run. It creates the tables and loads the
   fictional demo data; running it again is harmless.

**Or from your computer**, with the session/direct connection string of the **demo** project (Supabase → *Connect*):

```bash
DATABASE_URL_DIRECT="postgresql://postgres.<ref>:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" npm run db:migrate
```

Load the fictional demo data (only into an empty database):

```bash
DATABASE_URL_DIRECT="<same demo connection string>" npx tsx scripts/db.ts seed
```

The migrate command warns if the database user cannot switch to the `authenticated` / `service_role` roles; with the
default `postgres` user on Supabase it can.

### 3. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Demo value |
| --- | --- |
| `AUTH_SECRET` | 48 random characters, e.g. from `openssl rand -base64 48` - **required**, the build stops without it |
| `APP_URL` | the deployment URL, e.g. `https://180dc-hub.vercel.app` |
| `AUTH_PROVIDER` | `demo` |
| `DEMO_MODE` | `true` |
| `CRON_SECRET` | another random string |
| `EMAIL_PROVIDER` | `log` (nothing leaves the Hub) |
| `STORAGE_BACKEND` | `database` |
| `AI_MODE` | `mock`, or `live` together with `ANTHROPIC_API_KEY` |

Select all environments (Production, Preview, Development). Variables only apply to new deployments.

### 4. Deploy and check

Push to `main` or use *Deployments → ⋯ → Redeploy* in Vercel. Then open:

- `https://<your-app>/api/health` → `{"ok":true,"db":"up",...}`
- sign in as **Alex Romero (admin)** → *Admin → System*: every configuration line should be green

### 5. Background jobs

- `vercel.json` runs `/api/cron/daily` at 06:00 UTC (retention, follow-ups, lead scores, outbox). Vercel sends
  `CRON_SECRET` automatically.
- The Hobby plan allows only daily cron jobs. For throttled campaigns and follow-ups during the day, the GitHub workflow
  `.github/workflows/outbox-tick.yml` calls `/api/cron/outbox` every 15 minutes. Enable it with the repository
  **variable** `HUB_URL` and the repository **secret** `CRON_SECRET` (GitHub → Settings → Secrets and variables → Actions).
  On a Pro plan you can instead add `{ "path": "/api/cron/outbox", "schedule": "*/15 * * * *" }` to `vercel.json`.

### 6. Automatic migrations (optional)

`.github/workflows/migrate.yml` applies new migrations when they reach `main`. Add the repository secret
`DATABASE_URL_DIRECT` and create a GitHub **environment** called `production` with required reviewers, so every migration
waits for an approval.

---

## Stage 2 - production with Google Workspace sign-in

Do these steps in a **new** Supabase project (EU), migrated but not seeded.

### Google sign-in

1. Google Cloud Console (with a 180DC Workspace admin) → *APIs & Services* → **OAuth consent screen**: user type
   **Internal** - only accounts of your Workspace can sign in.
2. *Credentials* → *Create OAuth client ID* → *Web application*. Authorised redirect URI:
   `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
3. Supabase → *Authentication* → *Sign In / Providers* → **Google**: paste client ID and secret, enable.
4. Supabase → *Authentication* → *URL Configuration*: Site URL = your `APP_URL`; add `https://<your-app>/auth/callback`
   to the redirect URLs.
5. Vercel variables: `AUTH_PROVIDER=supabase`, `DEMO_MODE=false`, `ALLOWED_EMAIL_DOMAINS=<your workspace domain>`.

The Hub checks the domain again on the server after the Google redirect, creates a plain **member** account on the first
sign-in, and an admin grants roles in *Admin → Users & roles*.

**First admin:** sign in once, then run in the Supabase SQL editor (with your own address):

```sql
insert into user_roles (user_id, role)
select id, 'admin' from app_users where email = 'you@your-domain.org';
```

### E-mail

1. Create a Resend account, add and verify a sending domain (SPF and DKIM DNS records - ideally a subdomain such as
   `hub.your-domain.org`).
2. Vercel: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="180DC Barcelona <hub@hub.your-domain.org>"`.
3. Replies go to the sending member (`Reply-To`); outreach e-mails carry an unsubscribe link and the one-click
   unsubscribe header that Gmail and Outlook require for bulk senders.

### Files

`STORAGE_BACKEND=supabase`. The migration creates the private bucket `applications` (PDF only, 5 MB). CVs are only
served through `/api/files/<id>` after the row-level security check.

### AI (optional)

`AI_MODE=live`, `ANTHROPIC_API_KEY`. Every call is logged with tokens and cost (*Admin → System*). Before sending real CVs
to the API, add the provider to the privacy notice and check the data processing terms.

### Before real data goes in

- Replace the text of `/privacy` (`app/privacy/page.tsx`) with the real controller contact and retention periods, and
  set the new version on the open cycle (`update recruitment_cycles set privacy_notice_version = '<date>' where status = 'open'`),
  so the consent stored with each application refers to the text the applicant saw.
- Data processing agreements with Supabase, Vercel, Resend (and Anthropic if AI is live) - all offer standard DPAs.
- Decide retention periods per cycle (default 180 days after the decision).
- Remove the demo personas from the production database - they are only in the seed, which production never loads.
