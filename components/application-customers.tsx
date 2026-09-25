"use client";
import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { ArrowUpRight, KeyRound, RotateCw, ShieldCheck, ShieldOff, Users, Waypoints } from "lucide-react";
import { api, useData, ErrorBox } from "./ui";
import { useConfirm } from "./site-tools";

type Customer = { id: string; externalId: string; name: string; portalEnabled: boolean; _count: { endpoints: number } };
export async function openCustomerPortal(applicationId: string, customerId: string, action: "issue" | "rotate" = "issue") {
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Allow pop-ups to open the customer portal in a new tab.");
  tab.opener = null;
  try {
    const result = await api<{ portalPath: string | null }>(`/api/applications/${applicationId}/customers/${customerId}/portal`, { action });
    if (!result.portalPath) throw new Error("Customer portal is unavailable.");
    tab.location.replace(new URL(result.portalPath, window.location.origin).href);
  } catch (error) { tab.close(); throw error; }
}
export function CustomerSelect({ applicationId, value, onChange }: { applicationId: string; value?: string; onChange?: (id: string) => void }) {
  const { data } = useData<Customer[]>(`/api/applications/${applicationId}/customers`);
  return <div className="field"><label htmlFor="customerId">Customer</label><select id="customerId" name="customerId" required {...(value === undefined ? { defaultValue: "" } : { value, onChange: (event: ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value) })}><option value="" disabled>Select customer</option>{data?.map(customer => <option value={customer.id} key={customer.id}>{customer.name} ({customer.externalId})</option>)}</select></div>;
}
export function ApplicationCustomers({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const { data, error, reload } = useData<Customer[]>(`/api/applications/${applicationId}/customers`);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function portal(customerId: string, action: "issue" | "rotate" | "revoke") {
    if (action === "revoke" && !await confirm({ title: "Revoke this portal link?", description: "The current customer portal link will stop working immediately.", label: "Revoke link" })) return;
    setBusy(true); setFailure("");
    try {
      if (action !== "revoke") await openCustomerPortal(applicationId, customerId, action);
      else await api(`/api/applications/${applicationId}/customers/${customerId}/portal`, { action });
      await reload();
    } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  }

  return <section className="panel panel-body customer-section">
    <div className="customer-section-heading"><div><h2>Customers</h2><p className="muted">Give each customer their own endpoints and private portal.</p></div><span className="customer-total"><Users size={16} aria-hidden="true" />{data?.length ?? 0} customers</span></div>
    <ErrorBox error={error || failure} />
    {canManage && <form onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const values = new FormData(form); setBusy(true); setFailure(""); try { await api(`/api/applications/${applicationId}/customers`, { externalId: values.get("externalId"), name: values.get("name") }); form.reset(); await reload(); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } }}>
      <div className="form-row"><div className="field"><label htmlFor="customer-external-id">Your customer reference</label><input id="customer-external-id" name="externalId" maxLength={100} required /></div><div className="field"><label htmlFor="customer-name">Customer name</label><input id="customer-name" name="name" maxLength={100} required /></div><button className="btn" disabled={busy}>Add customer</button></div>
    </form>}
    {data?.length ? <div className="customer-grid">{data.map(customer => <article className="customer-card" key={customer.id}>
      <div className="customer-card-head"><span className="customer-avatar" aria-hidden="true">{customer.name.trim().slice(0, 2).toUpperCase()}</span><div className="customer-identity"><h3><Link href={`/applications/${applicationId}/customers/${customer.id}`}>{customer.name}</Link></h3><span>{customer.externalId}</span></div><span className={`customer-portal-status ${customer.portalEnabled ? "active" : ""}`}>{customer.portalEnabled ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}{customer.portalEnabled ? "Portal active" : "Portal not opened"}</span></div>
      <div className="customer-card-details"><div><Waypoints size={16} aria-hidden="true" /><span><strong>{customer._count.endpoints}</strong> {customer._count.endpoints === 1 ? "endpoint" : "endpoints"}</span></div><div><KeyRound size={16} aria-hidden="true" /><span className="customer-id"><small>API customer ID</small><code>{customer.id}</code></span></div></div>
      <div className="customer-card-actions"><Link className="customer-details-link" href={`/applications/${applicationId}/customers/${customer.id}`}>View customer <ArrowUpRight size={15} aria-hidden="true" /></Link>{canManage && <div className="customer-portal-actions"><button type="button" className="btn customer-open" disabled={busy} onClick={() => void portal(customer.id, "issue")}>Open portal <ArrowUpRight size={16} aria-hidden="true" /></button>{customer.portalEnabled && <><button type="button" className="customer-icon-action" aria-label={`Rotate portal link for ${customer.name}`} disabled={busy} onClick={() => void portal(customer.id, "rotate")}><RotateCw size={17} aria-hidden="true" /><span role="tooltip">Rotate & open new link</span></button><button type="button" className="customer-icon-action danger" aria-label={`Revoke portal link for ${customer.name}`} disabled={busy} onClick={() => void portal(customer.id, "revoke")}><ShieldOff size={17} aria-hidden="true" /><span role="tooltip">Revoke link</span></button></>}</div>}</div>
    </article>)}</div> : <div className="customer-empty"><Users size={28} aria-hidden="true" /><strong>No customers yet</strong><p>Add a customer to create endpoints and send events.</p></div>}
  </section>;
}
