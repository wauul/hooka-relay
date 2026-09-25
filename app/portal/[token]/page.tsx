"use client";
import { use, useState } from "react";
import { Brand } from "@/components/shell";
import { PreferencesMenu } from "@/components/preferences";
import { Activity, ArrowRight, CheckCircle2, Clock3, ExternalLink, KeyRound, Pause, Play, Plus, Radio, RefreshCw, RotateCcw, ShieldCheck, Trash2, Webhook } from "lucide-react";
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
  const activeCount = data?.endpoints.filter((ep: any) => ep.status === "ACTIVE").length ?? 0;
  const latestAttempt = data?.attempts[0];

  return <main id="main-content" className="portal-layout customer-portal">
    <header className="public-header"><Brand /><PreferencesMenu /></header>
    <section className="portal-hero">
      <div className="portal-hero-icon"><Webhook size={25} aria-hidden="true" /></div>
      <div><p className="eyebrow">CUSTOMER PORTAL</p><h1>{data?.customer || data?.application || "Your webhook delivery"}</h1><p>{data?.customer ? `${data.application} · ` : ""}Manage where your events go and follow every delivery.</p></div>
    </section>
    <ErrorBox error={error || failure} />
    {!data && !error && <LoadingState />}
    {data && <>
      <div className="portal-context"><ShieldCheck size={17} aria-hidden="true" /><span>{data.customer ? `Private access for ${data.customer}. Keep this link safe; ask the application owner to rotate it if shared.` : "This private browser session controls your endpoints. Contact the application owner if access is lost."}</span></div>
      <div className="portal-summary" aria-label="Delivery overview">
        <div><span className="portal-summary-icon"><Radio size={18} aria-hidden="true" /></span><p>Active endpoints</p><strong>{activeCount}<small> / {data.endpoints.length}</small></strong></div>
        <div><span className="portal-summary-icon"><Activity size={18} aria-hidden="true" /></span><p>Recent attempts</p><strong>{data.attempts.length}</strong></div>
        <div><span className="portal-summary-icon"><Clock3 size={18} aria-hidden="true" /></span><p>Latest delivery</p><strong className="portal-summary-status">{latestAttempt ? latestAttempt.status.replaceAll("_", " ") : "No attempts yet"}</strong></div>
      </div>

      <div className="portal-section-title"><div><p className="eyebrow">DESTINATIONS</p><h2>Your endpoints <span className="count">{data.endpoints.length}</span></h2><p>Endpoints receive the event types you subscribe to.</p></div><a className="btn secondary" href="#register-endpoint"><Plus size={16} aria-hidden="true" />Add endpoint</a></div>
      {data.endpoints.length ? <div className="portal-endpoint-grid">{data.endpoints.map((ep: any) => <section className="portal-endpoint-card" key={ep.id}>
        <div className="portal-endpoint-top"><span className={`portal-endpoint-icon ${ep.status === "ACTIVE" ? "active" : ""}`}><Webhook size={20} aria-hidden="true" /></span><div className="portal-endpoint-identity"><h3 title={ep.url}>{new URL(ep.url).host}</h3><a href={ep.url} target="_blank" rel="noopener noreferrer" className="portal-endpoint-url">{ep.url}<ExternalLink size={13} aria-hidden="true" /></a></div></div>
        <div className="portal-endpoint-meta"><Badge value={ep.status} />{ep.circuitState && ep.circuitState !== "CLOSED" && <Badge value={ep.circuitState} />}</div>
        <div className="portal-subscription"><span><Radio size={15} aria-hidden="true" /> Listening for</span><strong>{ep.eventTypes.includes("*") ? "All event types" : ep.eventTypes.join(", ")}</strong></div>
        <details className="portal-secret"><summary><KeyRound size={16} aria-hidden="true" /> Signing secret <ArrowRight size={15} aria-hidden="true" /></summary><div className="secret-row"><code>{ep.secret}</code><CopyButton value={ep.secret} /></div><p>Use this secret to verify webhook signatures on your server.</p></details>
        <div className="portal-endpoint-actions"><button className="btn secondary" disabled={busy} onClick={() => void action({ endpointId: ep.id, action: ep.status === "ACTIVE" ? "pause" : "resume" }, "PATCH")}>{ep.status === "ACTIVE" ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{ep.status === "ACTIVE" ? "Pause" : "Resume"}</button>
          <button className="btn quiet portal-delete" disabled={busy} onClick={async () => { if (await confirm({ title: "Delete endpoint?", description: "Permanently delete this endpoint and its delivery history?", label: "Delete endpoint" })) void action({ endpointId: ep.id }, "DELETE"); }}><Trash2 size={16} aria-hidden="true" />Delete</button></div>
      </section>)}</div> : <div className="portal-empty"><Webhook size={24} aria-hidden="true" /><strong>No endpoints yet</strong><p>Add a public HTTPS URL below to start receiving events.</p></div>}

      <section className="portal-create-card" id="register-endpoint"><div className="portal-create-icon"><Plus size={22} aria-hidden="true" /></div><div className="portal-create-main"><div className="portal-section-title"><div><p className="eyebrow">NEW DESTINATION</p><h2>Register an endpoint</h2><p>Connect a public HTTPS receiver to this customer.</p></div></div>
        <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ url: f.get("url"), eventTypes: String(f.get("types")).split(",").map(s => s.trim()).filter(Boolean) }, "POST"); }}>
          <div className="field"><label htmlFor="portal-url">Public HTTPS URL</label><input id="portal-url" name="url" type="url" placeholder="https://example.com/webhooks" maxLength={2000} required /><small>The address on your server that receives webhook requests.</small></div>
          <div className="field"><label htmlFor="portal-types">Event types</label><input id="portal-types" name="types" defaultValue="*" maxLength={6000} required /><small>Use * for all events, or separate types with commas.</small></div>
          <button className="btn" disabled={busy}><Plus size={16} aria-hidden="true" />{busy ? "Saving…" : "Register endpoint"}</button>
        </form></div>
      </section>
      <p className="portal-note"><Pause size={14} aria-hidden="true" /> Paused endpoints receive no new events. Resuming does not backfill events received while paused.</p>

      <section className="portal-history" aria-labelledby="portal-history-heading"><div className="portal-section-title"><div><p className="eyebrow">DELIVERY HISTORY</p><h2 id="portal-history-heading">Recent deliveries</h2><p>See what was sent and whether your receiver accepted it.</p></div><button className="btn quiet" onClick={() => void reload()}><RefreshCw size={16} aria-hidden="true" />Refresh</button></div>
        {data.attempts.length ? <div className="portal-table-wrap"><table><thead><tr><th>Event</th><th>Result</th><th>When</th></tr></thead><tbody>{data.attempts.map((a: any) => <tr key={a.id}><td><span className="portal-event-name">{a.event.type}</span></td><td><Badge value={a.status} /></td><td><time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time></td></tr>)}</tbody></table></div> : <div className="portal-empty compact"><CheckCircle2 size={22} aria-hidden="true" /><strong>No deliveries yet</strong><p>Attempts will appear here after an event reaches an endpoint.</p></div>}
      </section>

      {data.customer && <div className="portal-operations">
        <section className="portal-operation-card" aria-labelledby="portal-events-heading"><span className="portal-operation-icon"><RotateCcw size={20} aria-hidden="true" /></span><div className="portal-section-title"><div><p className="eyebrow">EVENT HISTORY</p><h2 id="portal-events-heading">Replay an event</h2><p>Send a retained event again after fixing a receiver.</p></div></div>
          {data.events?.length ? <div className="portal-table-wrap"><table><thead><tr><th>Event</th><th>Received</th><th>Replay to</th></tr></thead><tbody>{data.events.map((event: any) => { const eligible = data.endpoints.filter((endpoint: any) => endpoint.status === "ACTIVE" && (endpoint.eventTypes.includes("*") || endpoint.eventTypes.includes(event.type))); return <tr key={event.id}><td><span className="portal-event-name">{event.type}</span><small className="portal-event-id">{event.id}</small></td><td><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></td><td><form className="portal-replay-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ action: "replay", eventId: event.id, endpointId: f.get("endpointId") }, "POST"); }}><select name="endpointId" aria-label={`Destination for ${event.type}`} required defaultValue=""><option value="" disabled>{eligible.length ? "Choose endpoint" : "No matching endpoint"}</option>{eligible.map((endpoint: any) => <option value={endpoint.id} key={endpoint.id}>{endpoint.url}</option>)}</select><button className="btn secondary" disabled={busy || !eligible.length}><RotateCcw size={14} aria-hidden="true" />Replay</button></form></td></tr>; })}</tbody></table></div> : <div className="portal-empty compact"><Activity size={22} aria-hidden="true" /><strong>No retained events</strong><p>Events received for this customer will appear here.</p></div>}
          <p className="portal-card-footnote">Completed history is normally kept for 30 days. Expired events cannot be replayed.</p>
        </section>
        <section className="portal-operation-card" aria-labelledby="portal-recovery-heading"><span className="portal-operation-icon"><RefreshCw size={20} aria-hidden="true" /></span><div className="portal-section-title"><div><p className="eyebrow">FAILED DELIVERIES</p><h2 id="portal-recovery-heading">Recover deliveries</h2><p>Queue exhausted deliveries again, starting from a chosen time.</p></div></div>
          <form className="portal-recovery-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ action: "recover", since: new Date(String(f.get("since"))).toISOString(), ...(f.get("endpointId") ? { endpointId: f.get("endpointId") } : {}) }, "POST"); }}><div className="field"><label htmlFor="portal-recovery-since">Since</label><input id="portal-recovery-since" name="since" type="datetime-local" required /></div><div className="field"><label htmlFor="portal-recovery-endpoint">Destination</label><select id="portal-recovery-endpoint" name="endpointId"><option value="">All my endpoints</option>{data.endpoints.map((endpoint: any) => <option value={endpoint.id} key={endpoint.id}>{endpoint.url}</option>)}</select></div><button className="btn secondary" disabled={busy}><RefreshCw size={15} aria-hidden="true" />Start recovery</button></form>
          {data.recoveries?.length > 0 && <div className="portal-recovery-jobs">{data.recoveries.map((job: any) => <p key={job.id}><Badge value={job.status} /><span>{job.queued} queued · {new Date(job.createdAt).toLocaleString()}</span></p>)}</div>}
        </section>
      </div>}
    </>}
  </main>;
}
