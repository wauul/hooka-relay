"use client";

import { use, useState } from "react";
import { Activity, ArrowLeft, CalendarClock, ExternalLink, Link2, Pause, Pencil, Play, Radio, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { Shell } from "@/components/shell";
import { api, Badge, CopyButton, ErrorBox, Refresh, useData } from "@/components/ui";
import { useConfirm } from "@/components/site-tools";
import { ProviderIcon } from "@/components/provider-icon";
import { SourceEventLog } from "@/components/source-event-log";
import { RoutingBuilder } from "@/components/routing-builder";

type Attempt = { id: string; status: string; httpStatusCode: number | null; createdAt: string; event: { id: string; type: string } };
type Detail = { id: string; applicationId: string; name: string; status: string; providerCode: string; ingestionUrl?: string; destinationUrl: string | null; lastEventReceivedAt: string | null; lastVerifiedAt: string | null; lastVerificationFailure: string | null; lastVerificationFailureAt: string | null; liveListenerCount: number; canManage: boolean; provider: { displayName: string; docsUrl: string }; attempts: Attempt[] };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useData<Detail>(`/api/sources/${id}`, true);
  const confirm = useConfirm();
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function setStatus() {
    if (!data) return;
    setBusy(true); setFailure("");
    try { await api(`/api/sources/${id}`, { status: data.status === "PAUSED" ? "ACTIVE" : "PAUSED" }, "PATCH"); await reload(); }
    catch (cause) { setFailure((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const destinationUrl = String(form.get("destinationUrl") || "").trim();
    const providerSecret = String(form.get("providerSecret") || "").trim();
    const verificationToken = String(form.get("verificationToken") || "").trim();
    const updates = { name, ...(destinationUrl && destinationUrl !== data.destinationUrl ? { destinationUrl } : {}), ...(providerSecret ? { providerSecret } : {}), ...(verificationToken ? { verificationToken } : {}) };
    setBusy(true); setFailure("");
    try { await api(`/api/sources/${id}`, updates, "PATCH"); await reload(); setEditing(false); }
    catch (cause) { setFailure((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!data || !(await confirm({ title: `Delete ${data.name}?`, description: "This permanently removes the source, its inbound receipts, and its delivery history. The provider webhook destination must be removed separately.", label: "Delete source" }))) return;
    setBusy(true); setFailure("");
    try { await api(`/api/sources/${id}`, {}, "DELETE"); window.location.assign(`/applications/${data.applicationId}#sources`); }
    catch (cause) { setFailure((cause as Error).message); setBusy(false); }
  }

  return <Shell>
    <a className="back" href={data ? `/applications/${data.applicationId}#sources` : "/dashboard"}><ArrowLeft size={14} /> Webhook Sources</a>
    <div className="page-head"><div><div className="eyebrow">WEBHOOK SOURCE</div><h1>{data?.name || "Loading source…"}</h1>{data && <div className="visual-list-main"><ProviderIcon provider={data.providerCode} /><span>{data.provider.displayName}</span><Badge value={data.status} /></div>}</div><div className="source-management"><Refresh onClick={reload} />{data?.canManage && <><button className="btn secondary" onClick={() => setEditing(value => !value)}><Pencil size={15} />Edit</button>{data.status !== "SETUP_IN_PROGRESS" && <button className="btn secondary" disabled={busy} onClick={() => void setStatus()}>{data.status === "PAUSED" ? <Play size={15} /> : <Pause size={15} />}{data.status === "PAUSED" ? "Resume" : "Pause"}</button>}<button className="btn danger" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />Delete</button></>}</div></div>
    <ErrorBox error={error || failure} />
    {data && <>
      {editing && <section className="panel panel-body source-edit-panel"><div className="visual-list-main"><span className="visual-card-icon"><Pencil size={19} /></span><div><h2>Edit source</h2><p className="muted">Update the label, destination, or signing credentials.</p></div></div><form onSubmit={event => void save(event)}><div className="source-edit-grid"><label>Source name<input name="name" defaultValue={data.name} required maxLength={100} /></label><label>Public destination URL<input name="destinationUrl" type="url" defaultValue={data.destinationUrl || ""} placeholder="Leave blank for local listener only" /></label><label>New signing secret<input name="providerSecret" type="password" autoComplete="off" placeholder="Leave blank to keep current secret" /></label>{["FACEBOOK", "INSTAGRAM", "WHATSAPP"].includes(data.providerCode) && <label>New verification token<input name="verificationToken" type="password" autoComplete="off" placeholder="Leave blank to keep current token" minLength={8} /></label>}</div><div className="action-row"><button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button><button type="button" className="btn quiet" onClick={() => setEditing(false)}>Cancel</button></div></form></section>}
      <div className="visual-card-grid">
        <section className="visual-card"><div className="visual-card-top"><span>Connection</span><span className="visual-card-icon"><Link2 size={18} /></span></div><div className="visual-card-value">{data.destinationUrl ? "Public destination" : "Local listener only"}</div><p className="visual-card-caption source-url">{data.destinationUrl || "Add a destination any time from Edit."}</p><details><summary>Provider ingestion URL</summary>{data.ingestionUrl && <div className="secret-row"><code>{data.ingestionUrl}</code><CopyButton value={data.ingestionUrl} /></div>}</details></section>
        <section className="visual-card"><div className="visual-card-top"><span>Signature verification</span><span className="visual-card-icon"><ShieldCheck size={18} /></span></div><div className="visual-card-value"><Badge value={data.lastVerificationFailure ? "FAILED" : data.lastVerifiedAt ? "SUCCESS" : "PENDING"} /></div><p className="visual-card-caption">{data.lastVerificationFailure || (data.lastVerifiedAt ? `Last verified ${new Date(data.lastVerifiedAt).toLocaleString()}` : "Waiting for a signed event")}</p></section>
        <section className="visual-card"><div className="visual-card-top"><span>Live listener</span><span className="visual-card-icon"><Radio size={18} /></span></div><div className="visual-card-value">{data.liveListenerCount}</div><p className="visual-card-caption">{data.liveListenerCount ? "Connected local sessions" : "No local session connected"}</p><details><summary>CLI command</summary><code className="source-url">hooka listen --source {id} --forward-to http://localhost:3000/webhooks</code></details></section>
        <section className="visual-card"><div className="visual-card-top"><span>Last received</span><span className="visual-card-icon"><CalendarClock size={18} /></span></div><div className="visual-card-value" style={{ fontSize: 17 }}>{data.lastEventReceivedAt ? new Date(data.lastEventReceivedAt).toLocaleString() : "Waiting"}</div><p className="visual-card-caption"><a href={data.provider.docsUrl} target="_blank" rel="noopener noreferrer">Provider setup <ExternalLink size={12} aria-hidden="true" /></a></p></section>
      </div>
      <RoutingBuilder sourceId={id} />
      <SourceEventLog sourceId={id} />
      <section className="panel"><div className="panel-head"><div className="visual-list-main"><span className="visual-card-icon"><Activity size={18} /></span><h2>Recent destination attempts</h2></div><span className="count">{data.attempts.length}</span></div>{data.attempts.length ? <div className="table-wrap"><table className="resource-table"><thead><tr><th>Event</th><th>Status</th><th>HTTP</th><th>Time</th></tr></thead><tbody>{data.attempts.map(attempt => <tr key={attempt.id}><td><strong>{attempt.event.type}</strong><br /><small className="muted mono">{attempt.event.id}</small></td><td><Badge value={attempt.status} /></td><td>{attempt.httpStatusCode || "—"}</td><td>{new Date(attempt.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="visual-empty"><Webhook size={20} />No destination attempts yet.</div>}</section>
    </>}
  </Shell>;
}
