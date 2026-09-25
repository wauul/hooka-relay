"use client";
import { T } from "@/components/preferences";
import { use, useState } from "react";
import { Brand } from "@/components/shell";
import { PreferencesMenu } from "@/components/preferences";
import { Pause, Play, Trash2, RefreshCw, Plus } from "lucide-react";
import { useConfirm } from "@/components/site-tools";
import { api, useData, ErrorBox, CopyButton, Badge, LoadingState } from "@/components/ui";
export default function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const confirm = useConfirm();
  const url = `/api/portal/${token}`;
  const { data, error, reload } = useData<any>(url);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(body: unknown, method: string) {
    setBusy(true); setFailure("");
    try { await api(url, body, method); await reload(); } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  }
  return <main id="main-content" className="portal-layout">
    <header className="public-header"><Brand /><PreferencesMenu /></header>
    <div className="eyebrow">CUSTOMER PORTAL</div>
    <h1>{data?.application || "Your webhook endpoints"}</h1>
    <p className="muted">Manage your destinations and delivery history. No Hooka Relay account required.</p>
    <ErrorBox error={error || failure} />
    {!data && !error && <LoadingState />}
    {data && <>
      <p className="notice">Your access is saved in this browser. Clearing cookies or changing browsers removes access to these endpoints; contact the application owner for help.</p>
      <section className="panel panel-body"><h2><T text={"Register an endpoint"} /></h2>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ url: f.get("url"), eventTypes: String(f.get("types")).split(",").map(s => s.trim()).filter(Boolean) }, "POST"); }}>
          <div className="field"><label htmlFor="url"><T text={"Public HTTPS URL"} /></label><input id="url" name="url" type="url" placeholder="https://example.com/webhooks" maxLength={2000} required /></div>
          <div className="field"><label htmlFor="types">Event types, separated by commas</label><input id="types" name="types" defaultValue="*" maxLength={6000} required /></div>
          <button className="btn" disabled={busy}><Plus size={16} aria-hidden="true" /><T text={busy ? "Saving…" : "Register endpoint"} /></button>
        </form>
      </section>
      <h2><T text={"Your endpoints"} /><span className="count">{data.endpoints.length}</span></h2>
      {!data.endpoints.length && <p className="muted"><T text={"You have not registered any endpoints in this browser."} /></p>}
      {data.endpoints.map((ep: any) => <section className="panel panel-body" key={ep.id}>
        <h3 className="portal-url">{ep.url}</h3><p><Badge value={ep.status} /> <Badge value={ep.circuitState} /></p>
        <p className="muted">{ep.eventTypes.join(", ")}</p>
        <details><summary>Signing secret</summary><div className="secret-row"><code>{ep.secret}</code><CopyButton value={ep.secret} /></div></details>
        <div className="portal-actions"><button className="btn secondary" disabled={busy} onClick={() => void action({ endpointId: ep.id, action: ep.status === "ACTIVE" ? "pause" : "resume" }, "PATCH")}>{ep.status === "ACTIVE" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}<T text={ep.status === "ACTIVE" ? "Pause" : "Resume"} /></button>
          <button className="btn danger" disabled={busy} onClick={async () => { if (await confirm({ title: "Delete endpoint?", description: "Permanently delete this endpoint and its delivery history?", label: "Delete endpoint" })) void action({ endpointId: ep.id }, "DELETE"); }}><Trash2 size={16} aria-hidden="true" /><T text={"Delete endpoint"} /></button></div>
      </section>)}
      <p className="muted">Paused endpoints receive no new delivery work. Resuming does not backfill events received while paused.</p>
      <section className="panel"><div className="panel-head"><h2><T text={"Your recent deliveries"} /></h2><button className="btn quiet" onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" /><T text={"Refresh"} /></button></div>
        {data.attempts.length ? <div className="table-wrap"><table><thead><tr><th><T text={"Event type"} /></th><th>Result</th><th>Time</th></tr></thead><tbody>{data.attempts.map((a: any) => <tr key={a.id}><td>{a.event.type}</td><td><Badge value={a.status} /></td><td>{new Date(a.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="panel-body muted"><T text={"No delivery attempts yet."} /></p>}
      </section>
    </>}
  </main>;
}
