"use client";
import { useState } from "react";
import Link from "next/link";
import { Badge, ErrorBox, useData } from "@/components/ui";
import { DateTimePicker } from "@/components/date-time-picker";
import { usePreferences, useTranslation } from "@/components/preferences";

type Receipt = { id: string; eventId: string | null; eventType: string | null; provider: string; verified: boolean; failureReason: string | null; receivedAt: string; _count: { replays: number; liveAttempts: number } };
type Page = { receipts: Receipt[]; nextCursor: string | null };

export function SourceEventLog({ sourceId }: { sourceId: string }) {
  const t = useTranslation();
  const { language } = usePreferences();
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
  return <section className="panel source-events"><div className="panel-head"><div><h2>{t("Inbound events")}</h2><p className="muted">{t("Inspect original requests, signature checks, delivery attempts, and replays.")}</p></div></div>
    <form className="source-filters" onSubmit={event => { event.preventDefault(); setCursor(""); setFilters({ search: search.trim(), since, until, verification }); }}>
      <label>{t("Search body")}<input value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder={t("Order ID or payload text")} /></label>
      <DateTimePicker label="From" value={since} onChange={setSince} />
      <DateTimePicker label="To" value={until} onChange={setUntil} />
      <label>{t("Verification")}<select value={verification} onChange={event => setVerification(event.target.value)}><option value="">{t("All")}</option><option value="true">{t("Verified")}</option><option value="false">{t("Failed")}</option></select></label>
      <button className="btn secondary">{t("Filter")}</button>
    </form><ErrorBox error={error} />
    {data?.receipts.length ? <div className="table-wrap"><table className="resource-table"><thead><tr><th>{t("Received")}</th><th>{t("Event")}</th><th>{t("Verification")}</th><th>{t("Activity")}</th></tr></thead><tbody>{data.receipts.map(receipt => <tr key={receipt.id}><td className="resource-date">{new Date(receipt.receivedAt).toLocaleString(language)}</td><td><Link href={`/sources/${sourceId}/events/${receipt.id}`}><strong>{receipt.eventType || t("Rejected request")}</strong><br /><small className="muted mono">{receipt.eventId || receipt.id}</small></Link></td><td><Badge value={receipt.verified ? "SUCCESS" : "FAILED"} />{receipt.failureReason && <small className="muted"> {receipt.failureReason}</small>}</td><td className="resource-date">{receipt._count.replays} {t("replays")} · {receipt._count.liveAttempts} {t("live sends")}</td></tr>)}</tbody></table></div> : <div className="empty">{t("No inbound requests match these filters.")}</div>}
    {(cursor || data?.nextCursor) && <div className="source-pagination"><button className="btn quiet" disabled={!cursor} onClick={() => setCursor("")}>{t("First page")}</button><button className="btn secondary" disabled={!data?.nextCursor} onClick={() => setCursor(data?.nextCursor || "")}>{t("Next page")}</button></div>}
  </section>;
}
