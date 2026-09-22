"use client";
import { T } from "@/components/preferences";
import { useState } from "react";
import { api, useData, ErrorBox, CodeBlock } from "./ui";
export function EventSchemas({ applicationId, canManage }: { applicationId: string; canManage: boolean }) {
  const url = `/api/applications/${applicationId}/schemas`;
  const { data, error, reload } = useData<{ eventType: string; schema: unknown }[]>(url);
  const [failure, setFailure] = useState(""); const [busy, setBusy] = useState(false);
  async function save(body: unknown, method: string) { setBusy(true); setFailure(""); try { await api(url, body, method); await reload(); } catch (e) { setFailure((e as Error).message); } finally { setBusy(false); } }
  return <section className="panel panel-body" style={{ marginTop: 24 }}><h2><T text={"Event schemas"} /></h2><p className="muted">Optionally validate payloads for a specific event type. Types without a schema are accepted as before.</p><ErrorBox error={error || failure} />
    {data?.map(row => <details key={row.eventType} style={{ marginBottom: 16 }}><summary>{row.eventType}</summary><CodeBlock>{JSON.stringify(row.schema, null, 2)}</CodeBlock>{canManage && <button className="btn quiet" disabled={busy} onClick={() => void save({ eventType: row.eventType }, "DELETE")}>Remove validation</button>}</details>)}
    {canManage && <details><summary>Add or replace a schema</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { void save({ eventType: f.get("eventType"), schema: JSON.parse(String(f.get("schema"))) }, "PUT"); } catch { setFailure("Enter valid JSON."); } }} style={{ marginTop: 20 }}>
      <div className="field"><label htmlFor="schema-type"><T text={"Event type"} /></label><input id="schema-type" name="eventType" placeholder="order.shipped" maxLength={120} required /></div>
      <div className="field"><label htmlFor="event-schema">JSON Schema</label><textarea id="event-schema" name="schema" rows={9} maxLength={16384} defaultValue={'{\n  "type": "object",\n  "properties": {"orderId": {"type": "string"}},\n  "required": ["orderId"]\n}'} required /></div>
      <p className="muted">Supports basic draft-07 types, properties, required fields, bounds, enums and arrays. Regex, references and combinators are disabled for safety.</p><button className="btn" disabled={busy}>Save schema</button>
    </form></details>}
  </section>;
}
