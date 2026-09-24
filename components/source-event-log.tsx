"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, ErrorBox, useData } from "@/components/ui";
import { DateTimePicker } from "@/components/date-time-picker";

type Receipt = { id: string; eventId: string | null; eventType: string | null; provider: string; verified: boolean; failureReason: string | null; receivedAt: string; _count: { replays: number; liveAttempts: number } };
type Page = { receipts: Receipt[]; nextCursor: string | null };

export function SourceEventLog({ sourceId }: { sourceId: string }) {
  const [search, setSearch] = useState(""), [since, setSince] = useState(""), [until, setUntil] = useState(""), [verification, setVerification] = useState("");
  const [filters, setFilters] = useState({ search: "", since: "", until: "", verification: "" });
  const [cursor, setCursor] = useState("");
  const query = new URLSearchParams();
  if (filters.search) query.set("q", filters.search);
  if (filters.since && !Number.isNaN(Date.parse(filters.since))) query.set("since", new Date(filters.since).toISOString());
  if (filters.until && !Number.isNaN(Date.parse(filters.until))) query.set("until", new Date(filters.until).toISOString());
  if (filters.verification) query.set("verified", filters.verification);
  if (cursor) query.set("cursor", cursor);
  const { data, error } = useData<Page>(`/api/sources/${sourceId}/receipts?${query}`, true);
  return <section className="panel source-events"><div className="panel-head"><div><h2>Inbound events</h2><p className="muted">Inspect original requests, signature checks, delivery attempts, and replays.</p></div></div>
    <form className="source-filters" onSubmit={event => { event.preventDefault(); setCursor(""); setFilters({ search: search.trim(), since, until, verification }); }}>
      <label>Search body<input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder="Order ID or payload text" /></label>
      <DateTimePicker label="From" value={since} onChange={setSince} />
      <DateTimePicker label="To" value={until} onChange={setUntil} />
      <label>Verification<select value={verification} onChange={event => setVerification(event.target.value)}><option value="">All</option><option value="true">Verified</option><option value="false">Failed</option></select></label>
      <button className="btn secondary">Filter</button>
    </form><ErrorBox error={error} />
    {data?.receipts.length ? <div className="table-wrap"><table className="resource-table"><thead><tr><th>Received</th><th>Event</th><th>Verification</th><th>Activity</th></tr></thead><tbody>{data.receipts.map(receipt => <tr key={receipt.id}><td className="resource-date">{new Date(receipt.receivedAt).toLocaleString()}</td><td><Link href={`/sources/${sourceId}/events/${receipt.id}`}><strong>{receipt.eventType || "Rejected request"}</strong><br /><small className="muted mono">{receipt.eventId || receipt.id}</small></Link></td><td><Badge value={receipt.verified ? "SUCCESS" : "FAILED"} />{receipt.failureReason && <small className="muted"> {receipt.failureReason}</small>}</td><td className="resource-date">{receipt._count.replays} replay(s) · {receipt._count.liveAttempts} live send(s)</td></tr>)}</tbody></table></div> : <div className="empty">No inbound requests match these filters.</div>}
    {(cursor || data?.nextCursor) && <div className="source-pagination"><button className="btn quiet" disabled={!cursor} onClick={() => setCursor("")}>First page</button><button className="btn secondary" disabled={!data?.nextCursor} onClick={() => setCursor(data?.nextCursor || "")}>Next page</button></div>}
  </section>;
}
