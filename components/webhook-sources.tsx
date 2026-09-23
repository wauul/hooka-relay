"use client";
import Link from "next/link";
import { Plus, Webhook } from "lucide-react";
import { Badge, ErrorBox, useData } from "@/components/ui";

type Source = { id: string; name: string; providerDisplayName: string; status: string; lastEventReceivedAt: string | null; destinationUrl: string | null; endpoint: { circuitState: string } | null };
export function WebhookSources({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const { data, error } = useData<Source[]>(`/api/applications/${applicationId}/sources`, true);
  return <section className="panel">
    <div className="panel-head"><div><h2>Webhook Sources</h2><p className="muted">Receive webhooks from providers and forward them through Hooka Relay delivery.</p></div>{canManage && <Link className="btn" href={`/applications/${applicationId}/sources/new`}><Plus size={16} />Add source</Link>}</div>
    <ErrorBox error={error} />
    {data?.length ? <div className="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Last received</th><th>Destination</th></tr></thead><tbody>{data.map(source => <tr key={source.id}><td><Link href={`/sources/${source.id}`}><strong>{source.name}</strong><span className="muted" style={{ display: "block" }}>{source.providerDisplayName}</span></Link></td><td><Badge value={source.status} />{source.endpoint?.circuitState === "OPEN" && <span className="muted"> · Circuit open</span>}</td><td>{source.lastEventReceivedAt ? new Date(source.lastEventReceivedAt).toLocaleString() : "Waiting for first event"}</td><td className="mono">{source.destinationUrl || "Not set"}</td></tr>)}</tbody></table></div> : <div className="empty"><Webhook size={26} /><h3>No webhook sources yet</h3><p>Connect Stripe, GitHub, Slack, Shopify, Twilio, or a custom signed provider.</p>{canManage && <Link className="btn secondary" href={`/applications/${applicationId}/sources/new`}>Start setup</Link>}</div>}
  </section>;
}
