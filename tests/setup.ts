import { readFileSync } from "node:fs";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  // Docker is preinstalled on GitHub's standard Ubuntu runners. Local runs
  // require Docker Desktop (Linux containers) or an equivalent Docker daemon.
  // Never fall back to .env / Neon: failure to start Docker MUST fail this suite.
  const container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
    .withDatabase("hooka_relay_test").withUsername("test").withPassword("test")
    .withStartupTimeout(90_000).start();
  const databaseUrl = container.getConnectionUri();
  try {
    const require = createRequire(import.meta.url);
    // Seed the actual pre-workspace schema before applying new migrations.
    const { Client } = require("pg");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(readFileSync("prisma/migrations/202609140001_init/migration.sql", "utf8"));
      await client.query(`INSERT INTO "User" (id,email,"hashedPassword") VALUES
        ('migration-owner','migration@example.com','hash'), ('migration-empty','empty@example.com','hash'), ('migration-other','other@example.com','hash');
        INSERT INTO "Application" (id,"userId",name,"apiKey") VALUES
        ('migration-app','migration-owner','Existing app','migration-key'), ('migration-app2','migration-owner','Second app','migration-key2'), ('migration-app3','migration-other','Other app','migration-key3');
        INSERT INTO "Endpoint" (id,"applicationId",url,secret,"eventTypes") VALUES ('migration-endpoint','migration-app','https://example.com','original-secret',ARRAY['*']);
        INSERT INTO "Event" (id,"applicationId","idempotencyKey",type,payload) VALUES ('migration-event','migration-app','original-idempotency','test','{"preserved":true}');
        INSERT INTO "Delivery" (id,"eventId","endpointId") VALUES ('migration-delivery','migration-event','migration-endpoint');
        INSERT INTO "DeliveryAttempt" (id,"eventId","endpointId","deliveryId","attemptNumber",status) VALUES ('migration-attempt','migration-event','migration-endpoint','migration-delivery',1,'SUCCESS');
        INSERT INTO "FakeReceipt" (key,calls) VALUES ('migration-counter',2);`);
    } finally { await client.end(); }
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "resolve", "--applied", "202609140001_init"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe", timeout: 60000,
    });
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

