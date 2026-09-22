"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { api, ErrorBox, useData } from "./ui";

function TestResult({ endpointId, eventId }: { endpointId: string; eventId: string }) {
  const [stopped, setStopped] = useState(false);
  const { data, error } = useData<{ attempts: { status: string; httpStatusCode: number | null; durationMs: number | null }[] }>(`/api/endpoints/${endpointId}/events/${eventId}`, !stopped);
  useEffect(() => { const timer = setTimeout(() => setStopped(true), 30000); return () => clearTimeout(timer); }, []);
  const attempt = data?.attempts[0];
  const message = !attempt ? stopped ? "Still queued. Open the delivery log to follow progress." : "Queued — waiting for the worker…" : attempt.status === "SUCCESS" ? `Passed · HTTP ${attempt.httpStatusCode} · ${attempt.durationMs} ms` : attempt.status === "SKIPPED_CIRCUIT_OPEN" ? "Held by the circuit breaker. The normal recovery probe still applies." : `Failed · ${attempt.httpStatusCode ? `HTTP ${attempt.httpStatusCode}` : attempt.status.toLowerCase().replaceAll("_", " ")} · normal retry policy still applies.`;
  return <div style={{ marginTop: 20 }}><p role="status" aria-live="polite"><strong>{message}</strong></p><ErrorBox error={error} /><Link className="btn quiet" href={`/endpoints/${endpointId}/events/${eventId}`}>Open test delivery log →</Link></div>;
}

export function EndpointTest({ endpoint }: { endpoint: { id: string; status: string; circuitState: string } }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [eventId, setEventId] = useState("");
  const available = endpoint.status === "ACTIVE" && endpoint.circuitState === "CLOSED";
  return <section className="panel panel-body" style={{ marginBottom: 24 }}>
    <div className="eyebrow">VERIFY YOUR FIX</div>
    <h2 style={{ marginTop: 8 }}>Test this endpoint</h2>
    <p className="muted" style={{ maxWidth: 680, lineHeight: 1.7, margin: "12px 0 20px" }}>Send a synthetic <code>hooka.test</code> event only to this destination, using its current signing keys, headers and transform. This makes a real HTTP request. Normal throttling, retries and circuit protection apply.</p>
    <button className="btn secondary" disabled={busy || !available} onClick={async () => {
      setBusy(true); setError("");
      try { const result = await api<{ eventId: string }>(`/api/endpoints/${endpoint.id}/test`, {}); setEventId(result.eventId); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    }}><FlaskConical size={14} />{busy ? "Queueing test…" : "Send synthetic test"}</button>
    {!available && <p className="muted">Resume the endpoint or wait for its normal recovery probe before testing. This action never resets the circuit.</p>}
    <ErrorBox error={error} />
    {eventId && <TestResult key={eventId} endpointId={endpoint.id} eventId={eventId} />}
  </section>;
}
