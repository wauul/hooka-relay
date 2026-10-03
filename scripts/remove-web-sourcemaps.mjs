import { readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
// Next emits some server maps after webpack's upload hook. Upload the final
// server artifacts as well, pairing their debug IDs with those late maps.
if (process.env.SENTRY_AUTH_TOKEN) {
  const release = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA;
  if (!release || !process.env.SENTRY_ORG || !process.env.SENTRY_WEB_PROJECT) throw new Error("Web map upload requires release, organization and project");
  const cli = createRequire(import.meta.url).resolve("@sentry/cli/bin/sentry-cli");
  const env = { ...process.env, SENTRY_PROJECT: process.env.SENTRY_WEB_PROJECT };
  function pairMaps(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pairMaps(path);
      else if (path.endsWith(".js.map")) {
        const artifact = path.slice(0, -4);
        // Next can retain a proxy map after relocating/removing its JS artifact.
        if (!existsSync(artifact)) continue;
        const source = readFileSync(artifact, "utf8");
        const debugId = source.match(/sentry-dbid-([a-f0-9-]{36})/)?.[1];
        if (!debugId) throw new Error("Final server artifact lacks webpack debug ID");
        const map = JSON.parse(readFileSync(path, "utf8"));
        map.debug_id = debugId;
        map.debugId = debugId;
        writeFileSync(path, JSON.stringify(map));
        // Re-injecting would add a competing ID ahead of webpack's injection.
        // Keep webpack's runtime ID and coordinates; append only a lookup comment.
        writeFileSync(artifact, source + `\n//# debugId=${debugId}\n`);
      }
    }
  }
  pairMaps(".next/server");
  for (const args of [["sourcemaps", "upload", "--release", release, "--url-prefix", "app:///.next/server", ".next/server"]]) {
    try { execFileSync(process.execPath, [cli, ...args], { env, stdio: "pipe", timeout: 120_000 }); }
    catch { throw new Error("Final server map upload failed; build stopped (credentials/output withheld)"); }
  }
  console.log("Final Next server source maps uploaded");
}
// Defense in depth: the plugin can skip upload without a token. Never serve maps.
function clean(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) clean(path);
    else if (entry.name.endsWith(".map")) rmSync(path);
  }
}
if (existsSync(".next/static")) clean(".next/static");
if (existsSync(".next/server")) clean(".next/server");
