import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  // Docker is preinstalled on GitHub's standard Ubuntu runners. Local runs
  // require Docker Desktop (Linux containers) or an equivalent Docker daemon.
  // Never fall back to .env / Neon: failure to start Docker MUST fail this suite.
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("hooka_relay_test").withUsername("test").withPassword("test")
    .withStartupTimeout(90_000).start();
  const databaseUrl = container.getConnectionUri();
  try {
    const require = createRequire(import.meta.url);
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe", timeout: 60_000,
    });
    project.provide("databaseUrl", databaseUrl);
  } catch (error) {
    await container.stop();
    throw error;
  }
  // Vitest calls this global teardown on completion, including failed tests.
  // Testcontainers' resource reaper also handles abrupt process termination.
  return async () => { await container.stop(); };
}
