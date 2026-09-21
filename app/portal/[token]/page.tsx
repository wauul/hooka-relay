"use client";
import { use, useState } from "react";
import Link from "next/link";
import { api, useData, ErrorBox, CopyButton, Badge, LoadingState } from "@/components/ui";
export default function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const url = `/api/portal/${token}`;
  const { data, error, reload } = useData<any>(url);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(body: unknown, method: string) {
    setBusy(true); setFailure("");
    try { await api(url, body, method); await reload(); } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="portal-layout">
    <Link href="/" className="back">hooka relay</Link>
    <div className="eyebrow">CUSTOMER PORTAL</div>
    <h1>{data?.application || "Your webhook endpoints"}</h1>
    <p className="muted">Manage your destinations and delivery history. No Hooka Relay account required.</p>
    <ErrorBox error={error || failure} />
    {!data && !error && <LoadingState />}
    {data && <>
      <p className="notice">Your access is saved in this browser. Clearing cookies or changing browsers removes access to these endpoints; contact the application owner for help.</p>
      <section className="panel panel-body"><h2>Register an endpoint</h2>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ url: f.get("url"), eventTypes: String(f.get("types")).split(",").map(s => s.trim()).filter(Boolean) }, "POST"); }}>
          <div className="field"><label htmlFor="url">Public HTTPS URL</label><input id="url" name="url" type="url" placeholder="https://example.com/webhooks" maxLength={2000} required /></div>
          <div className="field"><label htmlFor="types">Event types, separated by commas</label><input id="types" name="types" defaultValue="*" maxLength={6000} required /></div>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Register endpoint"}</button>
        </form>
      </section>
      <h2>Your endpoints <span className="count">{data.endpoints.length}</span></h2>
      {!data.endpoints.length && <p className="muted">You have not registered any endpoints in this browser.</p>}
      {data.endpoints.map((ep: any) => <section className="panel panel-body" key={ep.id}>
        <h3 className="portal-url">{ep.url}</h3><p><Badge value={ep.status} /> <Badge value={ep.circuitState} /></p>
        <p className="muted">{ep.eventTypes.join(", ")}</p>
        <details><summary>Signing secret</summary><div className="secret-row"><code>{ep.secret}</code><CopyButton value={ep.secret} /></div></details>
        <div className="portal-actions"><button className="btn secondary" disabled={busy} onClick={() => void action({ endpointId: ep.id, action: ep.status === "ACTIVE" ? "pause" : "resume" }, "PATCH")}>{ep.status === "ACTIVE" ? "Pause" : "Resume"}</button>
          <button className="btn quiet" disabled={busy} onClick={() => { if (window.confirm("Delete this endpoint and its delivery history?")) void action({ endpointId: ep.id }, "DELETE"); }}>Delete endpoint</button></div>
      </section>)}
      <p className="muted">Paused endpoints receive no new delivery work. Resuming does not backfill events received while paused.</p>
      <section className="panel"><div className="panel-head"><h2>Your recent deliveries</h2><button className="btn quiet" onClick={() => void reload()}>Refresh</button></div>
        {data.attempts.length ? <div className="table-wrap"><table><thead><tr><th>Event type</th><th>Result</th><th>Time</th></tr></thead><tbody>{data.attempts.map((a: any) => <tr key={a.id}><td>{a.event.type}</td><td><Badge value={a.status} /></td><td>{new Date(a.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="panel-body muted">No delivery attempts yet.</p>}
      </section>
    </>}
  </main>;
}
