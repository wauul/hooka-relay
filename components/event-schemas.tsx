"use client";

import { Braces, CheckCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { T } from "@/components/preferences";
import { api, CodeBlock, ErrorBox, useData } from "./ui";

type Schema = { eventType: string; schema: unknown };
export function EventSchemas({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const url = `/api/applications/${applicationId}/schemas`;
  const { data, error, reload } = useData<Schema[]>(url);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(body: unknown, method: string) { setBusy(true); setFailure(""); try { await api(url, body, method); await reload(); } catch (cause) { setFailure((cause as Error).message); } finally { setBusy(false); } }

  return <section className="panel panel-body" style={{ marginTop: 24 }}>
    <div className="visual-list-main"><span className="visual-card-icon"><ShieldCheck size={20} /></span><div><h2><T text={"Event schemas"} /></h2><p className="muted">Validation rules for selected event types</p></div></div>
    <ErrorBox error={error || failure} />
    <div className="visual-card-grid"><div className="visual-card"><div className="visual-card-top"><span>Validated types</span><CheckCheck size={18} /></div><div className="visual-card-value">{data?.length ?? "—"}</div><p className="visual-card-caption">Other event types pass through.</p></div>
      {data?.map(row => <div className="visual-card" key={row.eventType}><div className="visual-card-top"><span>JSON schema</span><span className="visual-card-icon"><Braces size={17} /></span></div><div className="visual-card-value" style={{ fontSize: 16 }}>{row.eventType}</div><details className="inspector-detail"><summary>View rule</summary><CodeBlock>{JSON.stringify(row.schema, null, 2)}</CodeBlock>{canManage && <button className="btn quiet" disabled={busy} onClick={() => void save({ eventType: row.eventType }, "DELETE")}><Trash2 size={14} />Remove validation</button>}</details></div>)}
    </div>
    {canManage && <details className="inspector-detail"><summary><Plus size={14} aria-hidden="true" /> Add or replace a schema</summary><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); try { void save({ eventType: form.get("eventType"), schema: JSON.parse(String(form.get("schema"))) }, "PUT"); } catch { setFailure("Enter valid JSON."); } }} style={{ marginTop: 20 }}>
      <div className="field"><label htmlFor="schema-type"><T text={"Event type"} /></label><input id="schema-type" name="eventType" placeholder="order.shipped" maxLength={120} required /></div>
      <div className="field"><label htmlFor="event-schema">JSON Schema</label><textarea id="event-schema" name="schema" rows={9} maxLength={16384} defaultValue={'{\n  "type": "object",\n  "properties": {"orderId": {"type": "string"}},\n  "required": ["orderId"]\n}'} required /></div>
      <button className="btn" disabled={busy}>Save schema</button>
    </form></details>}
  </section>;
}
