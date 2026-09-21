import Link from "next/link";
import { publicStatus } from "@/lib/public-status";
export const metadata = { title: "Service status | Hooka Relay" };
export default async function StatusPage() {
  let data;
  try { data = await publicStatus(); } catch { return <main className="portal-layout"><Link href="/">hooka relay</Link><h1>Status temporarily unavailable</h1><p>We could not load delivery metrics. Please check again shortly.</p></main>; }
  return <main className="portal-layout"><Link className="back" href="/">hooka relay</Link><div className="eyebrow">PUBLIC SERVICE STATUS</div>
    <h1>{data.degraded ? "Elevated delivery failures" : data.total ? "No sustained delivery incident detected" : "No recent delivery data"}</h1>
    <p className="muted">Aggregate delivery outcomes across Hooka Relay over the last 24 hours.</p>
    <div className="stats"><section className="stat"><div className="stat-label">Delivery success</div><div className="stat-value">{data.successRate === null ? "—" : `${data.successRate}%`}</div></section><section className="stat"><div className="stat-label">HTTP attempts</div><div className="stat-value">{data.total.toLocaleString()}</div></section></div>
    <section className="panel panel-body"><h2>Detected incidents</h2>{data.incidents.length ? data.incidents.map(i => <div key={i.start} style={{ marginTop: 20 }}><strong>Delivery success below 90%</strong><p className="muted">{new Date(i.start).toUTCString()} — {i.end ? new Date(i.end).toUTCString() : "Ongoing"}</p></div>) : <p className="muted">No sustained incidents detected in the observed windows.</p>}</section>
    <p className="muted">An incident requires two consecutive completed five-minute windows, each with at least five HTTP attempts and success below 90%. Missing or low-volume windows break the sequence. Receiver failures and deliberately failing test endpoints count; this measures observed delivery outcomes, not platform uptime. Circuit-open skips are excluded.</p>
    <p className="muted">Updated {new Date(data.checkedAt).toUTCString()}. Metrics are cached for up to 60 seconds.</p>
    <Link className="btn secondary" href="/status">Refresh status</Link>
  </main>;
}
