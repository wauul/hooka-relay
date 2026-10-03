import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const advisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const lintChain = new Set(["braces", "micromatch", "fast-glob", "@next/eslint-plugin-next", "eslint-config-next"]);
const expires = Date.parse("2026-11-03T00:00:00Z");
// This unpatched advisory is limited to trusted, local ESLint glob patterns.
// Never exempt a production installation or a different advisory/version/path.
export function assessAudit(report, lock, now = Date.now()) {
  if (!report.vulnerabilities || report.error) throw new Error("Dependency audit unavailable");
  const accepted = [], rejected = [];
  function causes(name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const item = report.vulnerabilities[name];
    if (!item) return [{ url: "unknown" }];
    return item.via.flatMap(v => typeof v === "string" ? causes(v, seen) : [v]);
  }
  for (const [name, item] of Object.entries(report.vulnerabilities)) {
    if (!["high", "critical"].includes(item.severity)) continue;
    const known = now < expires && lintChain.has(name) && item.nodes?.length &&
      item.nodes.every(node => lock.packages?.[node]?.dev === true) &&
      causes(name).length > 0 && causes(name).every(v => v.url === advisory && v.name === "braces") &&
      lock.packages?.["node_modules/braces"]?.version === "3.0.3";
    (known ? accepted : rejected).push(name);
  }
  return { accepted, rejected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json"], { encoding: "utf8", shell: process.platform === "win32" });
  try {
    if (run.error || !run.stdout) throw new Error("Dependency audit unavailable");
    const result = assessAudit(JSON.parse(run.stdout), JSON.parse(readFileSync("package-lock.json", "utf8")));
    if (result.accepted.length) console.warn("Unpatched development-only ESLint advisory GHSA-vfj7-8cjw-p6xm accepted until 2026-11-03:", result.accepted.join(", "));
    if (result.rejected.length) throw new Error("Unaccepted high/critical vulnerabilities: " + result.rejected.join(", "));
    console.log("Dependency security gate passed; production findings receive no exception");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
