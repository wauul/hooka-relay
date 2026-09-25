import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { userId } from "@/lib/access";
import { db } from "@/lib/db";
import { operatorAllowed, operatorUsage } from "@/lib/usage";

export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; workspaceId?: string }> }) {
  let uid: string;
  try { uid = await userId(); } catch { notFound(); }
  const user = await db.user.findUnique({ where: { id: uid }, select: { email: true } });
  if (!user || !operatorAllowed(user.email)) notFound();
  const params = await searchParams;
  const url = new URL("https://hooka.invalid/operator/usage");
  for (const key of ["from", "to", "workspaceId"] as const) if (params[key]) url.searchParams.set(key, params[key]);
  const report = await operatorUsage(user.email, url);
  const csv = new URLSearchParams(url.searchParams); csv.set("format", "csv");
  return <Shell><div className="page-head"><div><div className="eyebrow">OPERATOR</div><h1>Workspace usage</h1><p className="muted">Manual invoicing: accepted events are the billable unit. Deliveries and retries are shown separately.</p></div></div>
    <form className="panel panel-body" method="get"><div className="form-row"><div className="field"><label htmlFor="usage-from">From month</label><input id="usage-from" type="month" name="from" defaultValue={report.from} /></div><div className="field"><label htmlFor="usage-to">To month</label><input id="usage-to" type="month" name="to" defaultValue={report.to} /></div><div className="field"><label htmlFor="usage-workspace">Workspace ID</label><input id="usage-workspace" name="workspaceId" defaultValue={params.workspaceId || ""} /></div><button className="btn">Filter</button><a className="btn secondary" href={`/api/operator/usage?${csv.toString()}`}>Export CSV</a></div></form>
    <section className="panel"><div className="panel-head"><h2>Monthly usage</h2></div><div className="table-wrap"><table className="resource-table"><thead><tr><th>Month</th><th>Workspace</th><th>Accepted events</th><th>Destination deliveries</th><th>Retry attempts</th></tr></thead><tbody>{report.rows.map(row => <tr key={`${row.workspaceId}-${row.month}`}><td>{row.month}</td><td>{row.workspaceName}<br /><small>{row.workspaceId}</small></td><td>{row.acceptedEvents}</td><td>{row.destinationDeliveries}</td><td>{row.retryAttempts}</td></tr>)}</tbody></table></div></section>
  </Shell>;
}
