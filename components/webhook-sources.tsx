"use client";
import Link from "next/link";
import { Plus, Webhook } from "lucide-react";
import { Badge, ErrorBox, useData } from "@/components/ui";
import { ProviderIcon } from "@/components/provider-icon";

type Source = { id: string; name: string; provider: string; providerDisplayName: string; status: string; lastEventReceivedAt: string | null; destinationUrl: string | null; endpoint: { circuitState: string } | null };
export function WebhookSources({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const { data, error } = useData<Source[]>(`/api/applications/${applicationId}/sources`, true);
  return <section className="panel">
    <div className="panel-head"><div><h2>Webhook Sources</h2><p className="muted">Receive webhooks from providers and forward them through Hooka Relay delivery.</p></div>{canManage && <Link className="btn" href={`/applications/${applicationId}/sources/new`}><Plus size={16} />Add source</Link>}</div>
    <ErrorBox error={error} />
    {data?.length ? <div className="table-wrap"><table className="resource-table"><thead><tr><th>Source</th><th>Destination</th><th>Last received</th><th>Status</th></tr></thead><tbody>{data.map(source => <tr key={source.id}><td><Link className="resource-main" href={source.status === "SETUP_IN_PROGRESS" && canManage ? `/applications/${applicationId}/sources/new?source=${source.id}` : `/sources/${source.id}`}><ProviderIcon provider={source.provider} /><span className="resource-text"><strong>{source.name}</strong><small>{source.providerDisplayName}{source.status === "SETUP_IN_PROGRESS" ? " · Continue setup" : ""}</small></span><span className="resource-arrow">↗</span></Link></td><td><span className="resource-destination" title={source.destinationUrl || "Not set"}>{source.destinationUrl || "Not set"}</span></td><td className="resource-date">{source.lastEventReceivedAt ? new Date(source.lastEventReceivedAt).toLocaleString() : "Waiting for first event"}</td><td><div className="resource-status"><Badge value={source.status} />{source.endpoint?.circuitState === "OPEN" && <Badge value="OPEN" />}</div></td></tr>)}</tbody></table></div> : <div className="empty"><Webhook size={26} /><h3>No webhook sources yet</h3><p>Connect a signed provider or use Custom / Manual setup.</p>{canManage && <Link className="btn secondary" href={`/applications/${applicationId}/sources/new`}>Start setup</Link>}</div>}
  </section>;
}
