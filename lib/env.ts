import "server-only";
import { z } from "zod";

/**
 * All configuration in one validated place. Secrets are only ever read on the server.
 * Copy .env.example to .env.local for local development.
 */
const schema = z.object({
  DATABASE_URL: z.string().url().default("postgres://postgres:postgres@127.0.0.1:54322/postgres"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // auth: "demo" = pick a fictional persona (demo/staging only), "supabase" = Supabase Auth (Google)
  AUTH_PROVIDER: z.enum(["demo", "supabase"]).default("demo"),
  AUTH_SECRET: z.string().min(32).default("dev-only-secret-change-me-dev-only-secret"),
  DEMO_MODE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ALLOWED_EMAIL_DOMAINS: z.string().default("").transform((v) => v.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  STORAGE_BACKEND: z.enum(["database", "disk", "supabase"]).default("database"),
  STORAGE_DISK_PATH: z.string().default(".data/storage"),

  EMAIL_PROVIDER: z.enum(["log", "resend"]).default("log"),
  EMAIL_FROM: z.string().default("180DC Barcelona <hub@180dc-demo.example.org>"),
  RESEND_API_KEY: z.string().optional(),

  AI_MODE: z.enum(["off", "mock", "live"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),

  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // empty strings (unset values in .env files) count as "not set"
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  // Safety rails for production
  if (process.env.VERCEL_ENV === "production" && e.AUTH_PROVIDER === "demo" && !e.DEMO_MODE) {
    throw new Error("AUTH_PROVIDER=demo is only allowed when DEMO_MODE=true (fake data).");
  }
  if (process.env.NODE_ENV === "production" && e.AUTH_SECRET.startsWith("dev-only")) {
    if (e.AUTH_PROVIDER === "demo" && process.env.VERCEL_ENV) {
      throw new Error("Set AUTH_SECRET (32+ random characters) in the Vercel project settings.");
    }
  }
  cached = e;
  return e;
}
