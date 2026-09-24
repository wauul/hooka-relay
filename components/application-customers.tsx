"use client";
import { useState } from "react";
import { api, useData, ErrorBox, CopyButton } from "./ui";

type Customer = { id: string; externalId: string; name: string; portalEnabled: boolean; _count: { endpoints: number } };
export function CustomerSelect({ applicationId }: { applicationId: string }) {
  const { data } = useData<Customer[]>(`/api/applications/${applicationId}/customers`);
  return <div className="field"><label htmlFor="customerId">Customer</label><select id="customerId" name="customerId" required defaultValue=""><option value="" disabled>Select customer</option>{data?.map(customer => <option value={customer.id} key={customer.id}>{customer.name} ({customer.externalId})</option>)}</select></div>;
}
export function ApplicationCustomers({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const { data, error, reload } = useData<Customer[]>(`/api/applications/${applicationId}/customers`);
  const [failure, setFailure] = useState("");
  const [link, setLink] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function portal(customerId: string, action: "issue" | "rotate" | "revoke") {
    setBusy(true); setFailure("");
    try {
      const result = await api(`/api/applications/${applicationId}/customers/${customerId}/portal`, { action });
      setLink(result.portalPath ? { id: customerId, value: window.location.origin + result.portalPath } : null);
      await reload();
    } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel panel-body">
    <h2>Customers</h2><p className="muted">Each customer has its own endpoints, event history, recovery work, and revocable portal link. Use the customer ID in the authenticated event API field.</p>
    <ErrorBox error={error || failure} />
    {canManage && <form onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const values = new FormData(form); setBusy(true); setFailure(""); try { await api(`/api/applications/${applicationId}/customers`, { externalId: values.get("externalId"), name: values.get("name") }); form.reset(); await reload(); } catch (error) { setFailure((error as Error).message); } finally { setBusy(false); } }}>
      <div className="form-row"><div className="field"><label htmlFor="customer-external-id">Your customer reference</label><input id="customer-external-id" name="externalId" maxLength={100} required /></div><div className="field"><label htmlFor="customer-name">Customer name</label><input id="customer-name" name="name" maxLength={100} required /></div><button className="btn" disabled={busy}>Add customer</button></div>
    </form>}
    <div className="table-wrap"><table className="resource-table"><thead><tr><th>Customer</th><th>Customer ID</th><th>Endpoints</th><th>Portal</th></tr></thead><tbody>{data?.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><br /><small>{customer.externalId}</small></td><td><code>{customer.id}</code><CopyButton value={customer.id} /></td><td>{customer._count.endpoints}</td><td>{canManage && <div className="action-row"><button className="btn quiet" disabled={busy} onClick={() => void portal(customer.id, "issue")}>{customer.portalEnabled ? "Show link" : "Issue link"}</button>{customer.portalEnabled && <><button className="btn quiet" disabled={busy} onClick={() => void portal(customer.id, "rotate")}>Rotate</button><button className="btn danger" disabled={busy} onClick={() => void portal(customer.id, "revoke")}>Revoke</button></>}</div>}{link?.id === customer.id && <div className="secret-row"><code>{link.value}</code><CopyButton value={link.value} /></div>}</td></tr>)}</tbody></table></div>
    {!data?.length && <p className="muted">Add a customer before creating endpoints or sending events.</p>}
  </section>;
}
