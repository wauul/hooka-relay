import { captureException, getClient, withIsolationScope } from "@sentry/core";
import { expectedError, safeOperation, safeTags } from "./sentry-privacy";
// One shared weak set also covers independently bundled Next handlers.
const shared = globalThis as typeof globalThis & { hookaReported?: WeakSet<object>; hookaReports?: Map<string, number> };
export function reportUnexpected(error: unknown, operation: string, tags: Record<string, unknown> = {}, bounded = false) {
  try {
    const client = getClient();
    if (!client || client.getOptions().enabled === false || !client.getDsn() || expectedError(error)) return;
    shared.hookaReported ??= new WeakSet();
    if (error && typeof error === "object") {
      if (shared.hookaReported.has(error)) return;
      shared.hookaReported.add(error);
    }
    const op = safeOperation(operation);
    if (bounded) {
      shared.hookaReports ??= new Map();
      const previous = shared.hookaReports.get(op) || 0;
      if (Date.now() - previous < 60_000) return;
      shared.hookaReports.set(op, Date.now());
    }
    captureException(error, { tags: safeTags({ ...tags, operation: op, outcome: "failure" }) });
  } catch { /* Monitoring must never interrupt application work. */ }
}
export function isolatedOperation<T>(operation: string, tags: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  return withIsolationScope(async scope => {
    scope.clear(); scope.setTags(safeTags({ ...tags, operation }));
    try { return await run(); }
    catch (error) { reportUnexpected(error, operation, tags, operation.startsWith("worker.") && operation !== "worker.fatal"); throw error; }
  });
}
