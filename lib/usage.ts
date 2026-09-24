import { db } from "./db";
import { WorkspaceError } from "./workspaces";

export function operatorAllowed(email: string) {
  return (process.env.OPERATOR_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}
function month(value: string | null, fallback: Date) {
  if (!value) return new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), 1));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new WorkspaceError(400, "Use YYYY-MM for month filters");
  return new Date(`${value}-01T00:00:00.000Z`);
}
export async function operatorUsage(email: string, url: URL) {
  if (!operatorAllowed(email)) throw new WorkspaceError(404, "Not found");
  const to = month(url.searchParams.get("to"), new Date());
  const from = month(url.searchParams.get("from"), new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1)));
  const span = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  if (span < 0 || span > 23) throw new WorkspaceError(400, "Select up to 24 months");
  const workspaceId = url.searchParams.get("workspaceId") || undefined;
  if (workspaceId && (workspaceId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(workspaceId))) throw new WorkspaceError(400, "Invalid workspace");
  const rows = await db.workspaceUsageMonth.findMany({ where: { month: { gte: from, lte: to }, ...(workspaceId ? { workspaceId } : {}) }, include: { workspace: { select: { name: true } } }, orderBy: [{ month: "asc" }, { workspaceId: "asc" }] });
  return { from: from.toISOString().slice(0, 7), to: to.toISOString().slice(0, 7), billableUnit: "accepted_event", rows: rows.map(row => ({ month: row.month.toISOString().slice(0, 7), workspaceId: row.workspaceId, workspaceName: row.workspace.name, acceptedEvents: row.acceptedEvents.toString(), destinationDeliveries: row.destinationDeliveries.toString(), retryAttempts: row.retryAttempts.toString(), calculation: `${row.acceptedEvents} accepted events × agreed manual rate` })) };
}
function cell(value: string) {
  const safe = /^[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function usageCsv(report: Awaited<ReturnType<typeof operatorUsage>>) {
  return ["month,workspace_id,workspace_name,billable_unit,accepted_events,destination_deliveries,retry_attempts,calculation", ...report.rows.map(row => [row.month, row.workspaceId, row.workspaceName, report.billableUnit, row.acceptedEvents, row.destinationDeliveries, row.retryAttempts, row.calculation].map(cell).join(","))].join("\r\n") + "\r\n";
}
