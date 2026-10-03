import { readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tokenFile = "/run/secrets/sentry_auth_token";
const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : process.env.SENTRY_AUTH_TOKEN;
const release = process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
const upload = !!token;
if (upload) {
  if (!release || !process.env.SENTRY_ORG || !process.env.SENTRY_WORKER_PROJECT) throw new Error("Worker source map upload requires release, organization and worker project");
  const env = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_RELEASE: release, SENTRY_PROJECT: process.env.SENTRY_WORKER_PROJECT };
  const cli = require.resolve("@sentry/cli/bin/sentry-cli");
  // Inject debug IDs into the exact artifacts shipped in this image. Do not rebuild after upload.
  for (const args of [["sourcemaps", "inject", "dist"], ["sourcemaps", "upload", "--release", release, "dist"]]) {
    try { execFileSync(process.execPath, [cli, ...args], { env, stdio: "pipe", timeout: 120_000 }); }
    catch { throw new Error("Worker source map upload failed; deployment stopped (credentials/output withheld)"); }
  }
  console.log("Worker source maps uploaded for configured release");
} else console.log("Worker source map upload skipped: no build-only token");
function clean(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) clean(path);
    else if (entry.name.endsWith(".map")) rmSync(path);
  }
}
if (existsSync("dist")) clean("dist");
