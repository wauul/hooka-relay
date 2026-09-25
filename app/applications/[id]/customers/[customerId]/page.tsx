"use client";
import { use, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, ArrowUpRight, Radio, ShieldCheck, Waypoints } from "lucide-react";
import { Shell } from "@/components/shell";
import { ActivityChart, DeliveryMix, type ActivityData } from "@/components/activity-chart";
import { openCustomerPortal } from "@/components/application-customers";
import { ErrorBox, LoadingState, useData } from "@/components/ui";

export default function Page({ params }: { params: Promise<{ id: string; customerId: string }> }) {
  const { id, customerId } = use(params);
  const { data, error, reload } = useData<ActivityData>(`/api/applications/${id}/activity?customerId=${encodeURIComponent(customerId)}`);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  return <Shell>
    <Link className="back" href={`/applications/${id}#customers`}><ArrowLeft size={14} /> Customers</Link>
    <ErrorBox error={error || failure} />
    {!data && !error && <LoadingState />}
    {data?.customer && <>
      <div className="page-head customer-detail-head"><div><div className="eyebrow">CUSTOMER</div><h1>{data.customer.name}</h1><p className="muted">{data.customer.externalId} · Created {new Date(data.customer.createdAt).toLocaleDateString()}</p></div>{data.canManage && <button className="btn" disabled={busy} onClick={() => { setBusy(true); setFailure(""); void openCustomerPortal(id, customerId).then(() => reload()).catch(e => setFailure((e as Error).message)).finally(() => setBusy(false)); }}>Open portal <ArrowUpRight size={16} aria-hidden="true" /></button>}</div>
      <div className="customer-detail-stats"><section className="visual-card"><div className="visual-card-top"><span>Events · 14 days</span><span className="visual-card-icon"><Activity size={18} /></span></div><div className="visual-card-value">{data.events}</div><p className="visual-card-caption">Received for this customer</p></section><section className="visual-card"><div className="visual-card-top"><span>Endpoints</span><span className="visual-card-icon"><Waypoints size={18} /></span></div><div className="visual-card-value">{data.activeEndpoints}<small> / {data.endpoints}</small></div><p className="visual-card-caption">Active / total destinations</p></section><section className="visual-card"><div className="visual-card-top"><span>Webhook sources</span><span className="visual-card-icon"><Radio size={18} /></span></div><div className="visual-card-value">{data.sources}</div><p className="visual-card-caption">Connected inbound sources</p></section><section className="visual-card"><div className="visual-card-top"><span>Private portal</span><span className="visual-card-icon"><ShieldCheck size={18} /></span></div><div className="visual-card-value visual-card-word">{data.customer.portalEnabled ? "Active" : "Not opened"}</div><p className="visual-card-caption">Revocable customer access</p></section></div>
      <div className="customer-chart-grid"><ActivityChart data={data} /><DeliveryMix deliveries={data.deliveries} /></div>
      <div className="customer-detail-lists"><section className="panel panel-body"><h2>Recent events</h2>{data.recentEvents.length ? <ul>{data.recentEvents.map(event => <li key={event.id}><span><strong>{event.type}</strong><small>{new Date(event.createdAt).toLocaleString()}</small></span><code>{event.id}</code></li>)}</ul> : <p className="muted">No events yet.</p>}</section><section className="panel panel-body"><h2>Destinations & sources</h2>{data.endpointRows.length === 0 && data.sourceRows.length === 0 && <p className="muted">No connections yet.</p>}<ul>{data.endpointRows.map(endpoint => <li key={endpoint.id}><Link href={`/endpoints/${endpoint.id}`}><Waypoints size={15} /><span>{endpoint.url}</span><small>{endpoint.status}</small><ArrowUpRight size={14} /></Link></li>)}{data.sourceRows.map(source => <li key={source.id}><Link href={`/sources/${source.id}`}><Radio size={15} /><span>{source.name}</span><small>{source.status}</small><ArrowUpRight size={14} /></Link></li>)}</ul></section></div>
      <p className="customer-api-reference">API customer ID <code>{data.customer.id}</code></p>
    </>}
  </Shell>;
}
