import path from "node:path";
import { defineConfig } from "vitest/config";

/** Database tests: need a migrated + seeded Postgres (npm run db:reset), then `npm run test:db`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      "server-only": path.join(import.meta.dirname, "tests/support/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/db/**/*.test.ts"], fileParallelism: false, testTimeout: 30_000 },
});
