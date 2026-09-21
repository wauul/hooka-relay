import "dotenv/config";
import { db } from "../lib/db";
import { migrateSecrets } from "../lib/migrate-secrets";
if (process.env.CONFIRM_OFFLINE_SECRET_MIGRATION !== "yes") {
  throw new Error("Stop web writes and workers, take a protected backup, then set CONFIRM_OFFLINE_SECRET_MIGRATION=yes");
}
migrateSecrets(db).then(counts => console.log("Migrated records", counts)).catch(() => {
  console.error("Secret migration failed and rolled back. Check configuration and database access; no credentials are logged.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
