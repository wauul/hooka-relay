import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    // Tests never load .env. This invalid URL is a second guard against a unit
    // test accidentally using a developer's exported production credentials.
    env: { DATABASE_URL: "postgresql://test:test@127.0.0.1:1/never_connect", RABBITMQ_URL: "amqp://127.0.0.1:1", NEXTAUTH_SECRET: "test-only-secret" },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], clearMocks: true } },
      { extends: true, test: {
        name: "integration", include: ["tests/integration/**/*.test.ts"],
        globalSetup: ["./tests/setup.ts"], setupFiles: ["./tests/integration/env.ts"],
        fileParallelism: false, maxWorkers: 1, hookTimeout: 30_000, testTimeout: 15_000,
      } },
    ],
    coverage: {
      provider: "v8", reporter: ["text", "json-summary", "lcov", "html"],
      include: ["lib/circuitBreaker.ts", "lib/security.ts", "lib/events.ts", "lib/queue/topology.ts", "lib/queue/client.ts", "app/api/v1/events/route.ts"],
      // Deliberately measure the reliability/API modules, not untested UI files.
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
