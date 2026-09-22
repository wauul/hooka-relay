"use client";
import { EndpointOptions } from "@/components/endpoint-options";
import { EndpointSigning } from "@/components/endpoint-signing";
import { Select } from "@/components/select";
import { useState } from "react";
import { useConfirm } from "@/components/site-tools";
import { api } from "@/components/ui";
import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Activity,
  Timer,
  Sparkles,
  Radio,
} from "lucide-react";
import { CodeBlock } from "@/components/ui";
import { LoadingState } from "@/components/ui";
import { Shell } from "@/components/shell";
import { useData, Badge, CopyButton, ErrorBox, Refresh } from "@/components/ui";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const { data, error, reload } = useData<any>(
    `/api/endpoints/${resolvedParams.id}/attempts`,
    true,
  );
  const ep = data?.endpoint;
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  return (
    <Shell>
      <Link
        className="back"
        href={ep ? `/applications/${ep.applicationId}` : "/dashboard"}
      >
        <ArrowLeft size={13} />
        Back to application
      </Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">ENDPOINT OBSERVABILITY</div>
          <h1>Delivery overview</h1>
          <div className="muted mono" style={{ wordBreak: "break-all" }}>
            {ep?.url || "Loading endpoint…"}
          </div>
        </div>
        <Refresh onClick={reload} />
      </div>
      <ErrorBox error={error || failure} />
      {ep && <section className="panel panel-body"><h2>Endpoint status: {ep.status}</h2>{ep.status === "DISABLED" && <p role="status"><Link href={`/applications/${ep.applicationId}/backlog?endpoint_id=${ep.id}`}>View missed events and recovery tools</Link></p>}<p>{ep.status === "PAUSED" ? "Paused by your team: new events create no deliveries or skipped logs for this endpoint. Resuming will not backfill them." : ep.status === "DISABLED" ? "Delivery disabled by the circuit breaker; automatic recovery probes remain enabled." : "Active: matching new events create deliveries."} Pausing also holds queued attempts until resumed; a request already in flight may finish.</p>{ep.role !== "MEMBER" && <><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/endpoints/${ep.id}/${ep.status === "PAUSED" ? "resume" : "pause"}`, {}, "PATCH"); await reload(); } catch(e) { setFailure((e as Error).message); } finally { setBusy(false); } }}>{ep.status === "PAUSED" ? "Resume" : "Pause"}</button><button className="btn quiet" disabled={busy} onClick={async () => { if (!(await confirm({ title: "Delete endpoint?", description: "This permanently removes the endpoint and its delivery history.", label: "Delete endpoint" }))) return; try { await api(`/api/endpoints/${ep.id}`, {}, "DELETE"); window.location.assign(`/applications/${ep.applicationId}`); } catch(e) { setFailure((e as Error).message); } }}>Delete endpoint</button></>}</section>}
      {ep && ep.status === "ACTIVE" && <form className="panel panel-body" onSubmit={async e => { e.preventDefault(); const eventId = String(new FormData(e.currentTarget).get("eventId")); try { await api(`/api/events/${encodeURIComponent(eventId)}/replay`, { endpointId: ep.id }); await reload(); } catch(e) { setFailure((e as Error).message); } }}><label>Replay a stored event to this endpoint<input name="eventId" placeholder="Event ID (including events received while paused)" required /></label><button className="btn secondary">Replay event</button></form>}
      {ep && <><EndpointSigning endpoint={ep} reload={reload} /><EndpointOptions endpoint={ep} reload={reload} /></>}
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">
                Circuit breaker
                <ShieldCheck size={16} />
              </div>
              <div style={{ margin: "21px 0 13px" }}>
                <Badge value={ep.circuitState} />
              </div>
              <div className="stat-note">
                {ep.circuitState === "OPEN"
                  ? "Recovery probe after 10-minute cooldown"
                  : "Protecting your destination"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                Success rate
                <Activity size={16} />
              </div>
              <div className="stat-value">
                {data.successRate === null ? "—" : `${data.successRate}%`}
              </div>
              <div className="stat-note">
                {data.total} HTTP attempts · last 24 hours
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">
                Consecutive failures
                <Timer size={16} />
              </div>
              <div className="stat-value">
                {ep.consecutiveFailures}
                <span style={{ fontSize: 14, color: "#657082" }}> / 5</span>
              </div>
              <div className="stat-note">
                Success resets the failure counter
              </div>
            </div>
          </div>
          {ep.diagnosis && (
            <section className="panel">
              <div className="panel-head">
                <h2>
                  <Sparkles
                    size={14}
                    style={{
                      display: "inline",
                      marginRight: 8,
                      color: "var(--green)",
                    }}
                  />
                  AI failure diagnosis
                </h2>
                <span className="badge amber">
                  {ep.diagnosis.confidence} confidence
                </span>
              </div>
              <div className="panel-body">
                <strong>{ep.diagnosis.likelyCause}</strong>
                <p className="muted">{ep.diagnosis.suggestedFix}</p>
                <span className="muted" style={{ fontSize: 10 }}>
                  Groq analysis · {new Date(ep.diagnosedAt).toLocaleString()} ·
                  Advice may be incomplete.
                </span>
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>
                Recent delivery attempts{" "}
                <span className="count">{data.attempts.length}</span>
              </h2>
              <span className="muted" style={{ fontSize: 11 }}>
                Live · updates every 5s
              </span>
            </div>
            {data.attempts.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Attempt</th>
                      <th>HTTP</th>
                      <th>Duration</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.attempts.map((a: any) => (
                      <tr key={a.id}>
                        <td>
                          <Link
                            href={`/endpoints/${ep.id}/events/${a.eventId}`}
                          >
                            <strong>{a.event.type}</strong>
                            <div className="mono muted">
                              {a.eventId.slice(-12)} ↗
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Badge value={a.status} />
                        </td>
                        <td className="mono">{a.attemptNumber} / 5</td>
                        <td className="mono">
                          {a.httpStatusCode || a.error || "—"}
                        </td>
                        <td className="mono">
                          {a.durationMs === null ? "—" : `${a.durationMs} ms`}
                        </td>
                        <td className="muted">
                          {new Date(a.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Radio size={28} />
                <h3>Waiting for your first event</h3>
                <p>
                  Send a test event from your application. Every attempt will
                  appear here automatically.
                </p>
                <Link
                  className="btn secondary"
                  href={`/applications/${ep.applicationId}`}
                >
                  Send a test event →
                </Link>
              </div>
            )}
          </section>
          <section className="panel panel-body" style={{ marginTop: 24, marginBottom: 24 }}>
            <h2>Retry policy</h2><p className="muted">Default schedules: Standard: 5 attempts · Aggressive: 7 attempts · Relaxed: 4 attempts. Circuit protection still applies.</p>
            {ep.role === "MEMBER" ? <Badge value={ep.retryPolicy} /> : <Select label="Retry policy" value={ep.retryPolicy} options={[{ value: "STANDARD", label: "Standard", description: "30s, 2m, 5m, 15m" }, { value: "AGGRESSIVE", label: "Aggressive", description: "30s, 30s, 30s, 2m, 2m, 5m" }, { value: "RELAXED", label: "Relaxed", description: "5m, 15m, 30m" }]} onChange={async retryPolicy => { try { await api(`/api/endpoints/${ep.id}/retry-policy`, { retryPolicy }, "PATCH"); await reload(); } catch(e) { setFailure((e as Error).message); } }} />}
            <p className="muted">Changes apply to subsequent failures. Already scheduled delays keep their due times.</p>
          </section>
          <details className="panel panel-body">
            <summary style={{ cursor: "pointer" }}>
              Endpoint configuration & signing secret
            </summary>
            <div style={{ marginTop: 22 }}>
              <label>Subscribed event types</label>
              <CodeBlock>{ep.eventTypes.join(", ")}</CodeBlock>
              {ep.secret && <>
              <label>HMAC signing secret</label>
              <div className="secret-row">
                <code>{ep.secret}</code>
                <CopyButton value={ep.secret} />
              </div>
              <p className="muted" style={{ fontSize: 11 }}>
                Used to verify {ep.signatureFormat === "STANDARD" ? "webhook-signature" : "X-Webhook-Signature"}. Never expose this secret in
                client applications.
              </p>
              </>}
            </div>
          </details>
        </>
      )}
    </Shell>
  );
}
