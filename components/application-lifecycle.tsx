"use client";
import { T } from "@/components/preferences";
import { KeyRound, Plus, Upload } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { api, useData, ErrorBox, CopyButton, CodeBlock } from "./ui";
import { Select } from "./select";
export function ApplicationLifecycle({ id, canManage }: { id: string; canManage: boolean }) {
  const catalog = useData<any[]>(`/api/applications/${id}/event-types`);
  const [failure, setFailure] = useState("");
  return <>
    <section className="panel panel-body" style={{ marginTop: 24 }}><h2><T text={"Recovery & event catalog"} /></h2><p><Link href={`/applications/${id}/backlog`}>Browse missed events and recover failed deliveries →</Link></p><ErrorBox error={failure || catalog.error} />
      {(catalog.data || []).map(row => <details key={row.id} style={{ marginBottom: 12 }}><summary>{row.eventType} · v{row.version}</summary><p>{row.description || "No description"}</p>{row.schema && <CodeBlock>{JSON.stringify(row.schema, null, 2)}</CodeBlock>}</details>)}
      {canManage && <details><summary><T text={"Publish an event type version"} /></summary><form style={{ marginTop: 20 }} onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await api(`/api/applications/${id}/event-types`, { eventType: f.get("type"), description: f.get("description"), schema: String(f.get("schema")).trim() ? JSON.parse(String(f.get("schema"))) : null }); await catalog.reload(); } catch(e) { setFailure((e as Error).message); } }}>
        <div className="field"><label htmlFor="catalog-type"><T text={"Event type"} /></label><input id="catalog-type" name="type" maxLength={120} required /></div><div className="field"><label htmlFor="catalog-description"><T text={"Description"} /></label><textarea id="catalog-description" name="description" maxLength={2000} /></div><div className="field"><label htmlFor="catalog-schema"><T text={"Optional JSON Schema"} /></label><textarea id="catalog-schema" name="schema" rows={5} maxLength={16384} /></div><p className="muted">Publishing creates a new version. A blank schema removes validation for this event type; free-form event types remain supported.</p><button className="btn secondary"><Upload size={16} aria-hidden="true" /><T text={"Publish version"} /></button>
      </form></details>}
    </section>
  </>;
}
export function ScopedKeys({ id }: { id: string }) {
  const { data, error, reload } = useData<any[]>(`/api/applications/${id}/keys`);
  const [key, setKey] = useState(""), [failure, setFailure] = useState("");
  return <section className="panel panel-body" style={{ marginTop: 24 }}><h2><T text={"Scoped API keys"} /></h2><p className="muted">Existing application keys retain full access. Scoped keys can either read or ingest, and cannot manage resources.</p><ErrorBox error={error || failure} />
    {key && <p role="status" style={{ overflowWrap: "anywhere" }}>Save this key now; it will not be shown again. <code>{key}</code> <CopyButton value={key} /></p>}
    {(data || []).map(row => <div key={row.id} style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}><strong>{row.name}</strong><p>{row.scope} · Last used: {row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : "Never"} · Expires: {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : "Never"}</p><button className="btn quiet" onClick={async () => { try { await api(`/api/applications/${id}/keys`, { id: row.id }, "DELETE"); await reload(); } catch(e) { setFailure((e as Error).message); } }}><KeyRound size={16} aria-hidden="true" /><T text={"Revoke key"} /></button></div>)}
    <form style={{ marginTop: 24 }} onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { const result = await api(`/api/applications/${id}/keys`, { name: f.get("name"), scope: f.get("scope"), ...(f.get("expiry") ? { expiresAt: new Date(String(f.get("expiry"))).toISOString() } : {}) }); setKey(result.key); await reload(); } catch(e) { setFailure((e as Error).message); } }}>
      <div className="field"><label htmlFor="scoped-name"><T text={"Key name"} /></label><input id="scoped-name" name="name" maxLength={100} required /></div><div className="field"><Select label="Scope" name="scope" options={[{ value: "INGEST_ONLY", label: "Ingest only" }, { value: "READ_ONLY", label: "Read only" }]} /></div><div className="field"><label htmlFor="scoped-expiry"><T text={"Optional expiry"} /></label><input id="scoped-expiry" name="expiry" type="datetime-local" /></div><button className="btn secondary"><Plus size={16} aria-hidden="true" /><T text={"Create scoped key"} /></button>
    </form>
  </section>;
}
