"use client";
import Link from "next/link";
import { Plus, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { api, Badge, ErrorBox, useData } from "@/components/ui";
import { ProviderIcon } from "@/components/provider-icon";
import { useConfirm } from "@/components/site-tools";

type Source = { id: string; name: string; provider: string; providerDisplayName: string; status: string; lastEventReceivedAt: string | null; destinationUrl: string | null; endpoint: { circuitState: string } | null };
export function WebhookSources({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const { data, error, reload } = useData<Source[]>(`/api/applications/${applicationId}/sources`, true);
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  async function cancelSetup(source: Source) {
    if (!(await confirm({ title: `Cancel setup for ${source.name}?`, description: "This permanently deletes the draft source and any events it received. Remove its webhook from the provider separately if you already created one.", label: "Delete draft" }))) return;
    setBusyId(source.id); setFailure("");
    try { await api(`/api/sources/${source.id}`, {}, "DELETE"); await reload(); }
    catch (cause) { setFailure((cause as Error).message); }
    finally { setBusyId(null); }
  }

  return <section className="panel">
    <div className="panel-head"><div><h2>Webhook Sources</h2><p className="muted">Receive webhooks from providers and forward them through Hooka Relay delivery.</p></div>{canManage && <Link className="btn" href={`/applications/${applicationId}/sources/new`}><Plus size={16} />Add source</Link>}</div>
    <ErrorBox error={error || failure} />
    {data?.length ? <div className="table-wrap"><table className="resource-table"><thead><tr><th>Source</th><th>Destination</th><th>Last received</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{data.map(source => <tr key={source.id}>
      <td><Link className="resource-main" href={source.status === "SETUP_IN_PROGRESS" && canManage ? `/applications/${applicationId}/sources/new?source=${source.id}` : `/sources/${source.id}`}><ProviderIcon provider={source.provider} /><span className="resource-text"><strong>{source.name}</strong><small>{source.providerDisplayName}{source.status === "SETUP_IN_PROGRESS" ? " · Continue setup" : ""}</small></span><span className="resource-arrow">↗</span></Link></td>
      <td><span className="resource-destination" title={source.destinationUrl || "Not set"}>{source.destinationUrl || "Not set"}</span></td>
      <td className="resource-date">{source.lastEventReceivedAt ? new Date(source.lastEventReceivedAt).toLocaleString() : "Waiting for first event"}</td>
      <td><div className="resource-status"><Badge value={source.status} />{source.endpoint?.circuitState === "OPEN" && <Badge value="OPEN" />}</div></td>
      <td>{canManage && source.status === "SETUP_IN_PROGRESS" && <button type="button" className="replay-icon source-cancel" aria-label={`Cancel setup and delete ${source.name}`} title="Cancel setup" disabled={busyId !== null} onClick={() => void cancelSetup(source)}><Trash2 size={15} aria-hidden="true" /></button>}</td>
    </tr>)}</tbody></table></div> : <div className="empty"><Webhook size={26} /><h3>No webhook sources yet</h3><p>Connect a signed provider or use Custom / Manual setup.</p>{canManage && <Link className="btn secondary" href={`/applications/${applicationId}/sources/new`}>Start setup</Link>}</div>}
  </section>;
}
