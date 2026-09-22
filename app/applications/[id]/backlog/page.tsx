"use client";
import { use, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { api, useData, ErrorBox, CodeBlock } from "@/components/ui";
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <Suspense fallback={<p>Loading recovery tools...</p>}><Backlog params={params} /></Suspense>; }
function Backlog({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), search = useSearchParams();
  const [query, setQuery] = useState(() => new URLSearchParams({ ...(search.get("since") ? { since: search.get("since")! } : {}), ...(search.get("endpoint_id") ? { endpoint_id: search.get("endpoint_id")! } : {}) }).toString());
  const events = useData<any>(`/api/applications/${id}/events?${query}`), jobs = useData<any[]>(`/api/applications/${id}/recovery`), app = useData<any>(`/api/applications/${id}`);
  const [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const filters = new URLSearchParams(query);
  return <Shell><Link href={`/applications/${id}`}>Application</Link><h1>Missed events & recovery</h1><p className="muted">Browse stored events, including events matching the endpoint’s current subscriptions that arrived while paused. Historical deliveries remain visible even if subscriptions changed. Replay is explicit; ordering is not guaranteed.</p><ErrorBox error={failure || events.error || jobs.error} />{notice && <p role="status">{notice}</p>}
    <form className="panel panel-body" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), next = new URLSearchParams(); if (f.get("since")) next.set("since", String(f.get("since"))); if (f.get("endpoint")) next.set("endpoint_id", String(f.get("endpoint"))); setQuery(next.toString()); }}>
      <div className="field"><label htmlFor="backlog-since">After ISO timestamp or event ID (blank for all)</label><input id="backlog-since" name="since" defaultValue={filters.get("since") || ""} /></div><div className="field"><label htmlFor="backlog-endpoint">Optional endpoint ID</label><input id="backlog-endpoint" name="endpoint" defaultValue={filters.get("endpoint_id") || ""} /></div><button className="btn secondary">Apply filters</button>
    </form>
    <section className="panel panel-body" style={{ marginTop: 24 }}><h2>Stored events</h2>{(events.data?.events || []).map((event: any) => <details key={event.id} style={{ padding: "16px 0" }}><summary>{event.type} · {new Date(event.createdAt).toLocaleString()}</summary><code>{event.id}</code><CodeBlock>{JSON.stringify(event.payload, null, 2)}</CodeBlock><button className="btn secondary" onClick={async () => { try { const r = await api(`/api/events/${event.id}/replay`, filters.get("endpoint_id") ? { endpointId: filters.get("endpoint_id") } : {}); setNotice(`${r.queued} deliveries queued.`); } catch(e) { setFailure((e as Error).message); } }}>Replay event</button></details>)}{events.data?.hasMore && <button className="btn secondary" onClick={() => { const next = new URLSearchParams(query); next.set("cursor", events.data.nextCursor); setQuery(next.toString()); }}>Next page</button>}</section>
    <section className="panel panel-body" style={{ marginTop: 24 }}><h2>Bulk recovery</h2><p className="muted">Replays each latest exhausted delivery once. Work is queued durably in small batches, survives restarts and respects endpoint throttles and pauses. Existing pending or successful deliveries are excluded.</p>
      {app.data && app.data.role !== "MEMBER" && <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await api(`/api/applications/${id}/recovery`, { since: new Date(String(f.get("since"))).toISOString(), ...(filters.get("endpoint_id") ? { endpointId: filters.get("endpoint_id") } : {}) }); setNotice("Recovery started. Status updates below."); await jobs.reload(); } catch(e) { setFailure((e as Error).message); } }}><div className="field"><label htmlFor="recovery-since">Recover failed events received since</label><input id="recovery-since" type="datetime-local" name="since" required /></div><button className="btn secondary">Start recovery</button></form>}
      {(jobs.data || []).map(job => <p key={job.id}>{new Date(job.createdAt).toLocaleString()} · {job.status} · {job.queued} deliveries queued</p>)}
    </section>
  </Shell>;
}
