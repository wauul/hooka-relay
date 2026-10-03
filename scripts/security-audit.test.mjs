import { test } from "node:test";
import { strict as assert } from "node:assert";
import { assessAudit } from "./security-audit.mjs";
const make = () => ({ report: { vulnerabilities: { braces: { severity: "high", nodes: ["node_modules/braces"], via: [{ name: "braces", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] } } }, lock: { packages: { "node_modules/braces": { dev: true, version: "3.0.3" } } } });
test("only accepts the reviewed tooling advisory before expiry", () => {
  const { report, lock } = make();
  assert.deepEqual(assessAudit(report, lock, Date.parse("2026-10-03")), { accepted: ["braces"], rejected: [] });
  assert.deepEqual(assessAudit(report, lock, Date.parse("2026-11-03")).rejected, ["braces"]);
});
test("production exposure, new advisories and changed versions fail closed", () => {
  for (const change of [(x) => x.lock.packages["node_modules/braces"].dev = false, (x) => x.report.vulnerabilities.braces.via[0].url = "new-advisory", (x) => x.lock.packages["node_modules/braces"].version = "3.0.2"]) {
    const data = make(); change(data);
    assert.deepEqual(assessAudit(data.report, data.lock, Date.parse("2026-10-03")).rejected, ["braces"]);
  }
  assert.throws(() => assessAudit({ error: {} }, {}), /unavailable/);
});
