import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/test-database.ts";

export default defineConfig({
  test: {
    env: { LOG_LEVEL: "silent" },
    projects: [
      {
        // Lógica pura: no necesita base de datos.
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // Requiere Supabase local (npm run supabase:start).
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/global-setup.ts"],
          env: { DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
          // Las pruebas de integración comparten una sola base de datos.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/scripts/**", "src/main.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
