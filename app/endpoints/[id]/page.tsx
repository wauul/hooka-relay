"use client";
import { T } from "@/components/preferences";
import { Section, SectionNav, useSection } from "@/components/section-nav";
import { Trash2, RotateCcw, Play, Pause } from "lucide-react";
import { EndpointOptions } from "@/components/endpoint-options";
import { EndpointTest } from "@/components/endpoint-test";
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
  const section = useSection(["overview", "events", "security", "settings"]);
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
        <ArrowLeft size={13} /><T text={"Back to application"} /></Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">ENDPOINT OBSERVABILITY</div>
          <h1><T text={"Delivery overview"} /></h1>{ep && <p style={{ marginBottom: 14 }}><Badge value={ep.status} /></p>}
          <div className="muted mono" style={{ wordBreak: "break-all" }}>
            {ep?.url || "Loading endpoint…"}
          </div>
        </div>
        <Refresh onClick={reload} />
      </div>
      <ErrorBox error={error || failure} />
      <SectionNav active={section} items={[{ id: "overview", label: "Overview" }, { id: "events", label: "Events & Logs" }, { id: "security", label: "Signing & Security" }, { id: "settings", label: "Settings" }]} />
      <Section active={section} name="settings">
      {ep && <section className="panel panel-body"><h2><T text={"Endpoint status:"} />{" "}{ep.status}</h2>{ep.status === "DISABLED" && <p role="status"><Link href={`/applications/${ep.applicationId}/backlog?endpoint_id=${ep.id}`}>View missed events and recovery tools</Link></p>}<p>{ep.status === "PAUSED" ? "Paused by your team: new events create no deliveries or skipped logs for this endpoint. Resuming will not backfill them." : ep.status === "DISABLED" ? "Delivery disabled by the circuit breaker; automatic recovery probes remain enabled." : "Active: matching new events create deliveries."} Pausing also holds queued attempts until resumed; a request already in flight may finish.</p>{ep.role !== "MEMBER" && <><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/api/endpoints/${ep.id}/${ep.status === "PAUSED" ? "resume" : "pause"}`, {}, "PATCH"); await reload(); } catch(e) { setFailure((e as Error).message); } finally { setBusy(false); } }}>{ep.status === "PAUSED" ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}<T text={ep.status === "PAUSED" ? "Resume" : "Pause"} /></button><button className="btn danger" disabled={busy} onClick={async () => { if (!(await confirm({ title: "Delete endpoint?", description: "This permanently removes the endpoint and its delivery history.", label: "Delete endpoint" }))) return; try { await api(`/api/endpoints/${ep.id}`, {}, "DELETE"); window.location.assign(`/applications/${ep.applicationId}`); } catch(e) { setFailure((e as Error).message); } }}><Trash2 size={16} aria-hidden="true" /><T text={"Delete endpoint"} /></button></>}</section>}
      </Section>
      <Section active={section} name="events">
      {ep && ep.status === "ACTIVE" && <form className="panel panel-body" onSubmit={async e => { e.preventDefault(); const eventId = String(new FormData(e.currentTarget).get("eventId")); try { await api(`/api/events/${encodeURIComponent(eventId)}/replay`, { endpointId: ep.id }); await reload(); } catch(e) { setFailure((e as Error).message); } }}><label>Replay a stored event to this endpoint<input name="eventId" placeholder="Event ID (including events received while paused)" required /></label><button className="btn secondary"><RotateCcw size={16} aria-hidden="true" /><T text={"Replay event"} /></button></form>}
      </Section>
      <Section active={section} name="security">{ep && <EndpointSigning endpoint={ep} reload={reload} />}</Section>
      <Section active={section} name="settings">{ep && <EndpointOptions endpoint={ep} reload={reload} />}</Section>
      {!data && !error && <LoadingState />}
      {data && (
        <>
          <Section active={section} name="overview"><div className="stats">
            <div className="stat">
              <div className="stat-label"><T text={"Circuit breaker"} /><ShieldCheck size={16} />
              </div>
              <div style={{ margin: "21px 0 13px" }}>
                <Badge value={ep.circuitState} />
              </div>
              <div className="stat-note">
                {ep.circuitState === "OPEN"
                  ? "Recovery probe after 10-minute cooldown"
                  : ep.circuitState === "HALF_OPEN" ? "One probe checks whether delivery can recover" : "Healthy: requests are delivered normally"}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label"><T text={"Success rate"} /><Activity size={16} />
              </div>
              <div className="stat-value">
                {data.successRate === null ? "—" : `${data.successRate}%`}
              </div>
              <div className="stat-note">
                {data.total} HTTP attempts · last 24 hours
              </div>
            </div>
            <div className="stat">
              <div className="stat-label"><T text={"Consecutive failures"} /><Timer size={16} />
              </div>
              <div className="stat-value">
                {ep.consecutiveFailures}
                <span style={{ fontSize: 14, color: "#657082" }}> / 5</span>
              </div>
              <div className="stat-note"><T text={"Success resets the failure counter"} /></div>
            </div>
          </div>
          {data.pattern?.observed > 0 && <section className="panel panel-body" style={{ marginBottom: 24 }}>
            <div className="eyebrow">RECENT DELIVERY EVIDENCE</div>
            <h2 style={{ marginTop: 8 }}>{data.pattern.active ? "Failure pattern" : "Latest delivery"}</h2>
            <p style={{ lineHeight: 1.7 }}>{data.pattern.summary}</p>
            {data.pattern.changes.length > 0 && <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>{data.pattern.changes.map((change: string) => <li key={change} style={{ marginBottom: 8 }}>{change}</li>)}</ul>}
            <p className="muted">Based on {data.pattern.observed} recent HTTP attempts. Times are UTC; circuit-open skips are excluded. Observed changes do not establish the root cause.</p>
          </section>}
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
                  {data.pattern?.active ? "AI failure diagnosis" : "Previous AI diagnosis"}
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
          <EndpointTest endpoint={ep} /></Section>
          <Section active={section} name="events"><section className="panel">
            <div className="panel-head">
              <h2><T text={"Recent delivery attempts"} />{" "}
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
                <h3><T text={"Waiting for your first event"} /></h3>
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
          </Section><Section active={section} name="settings"><section className="panel panel-body" style={{ marginTop: 24, marginBottom: 24 }}>
            <h2><T text={"Retry policy"} /></h2><p className="muted">Default schedules: Standard: 5 attempts · Aggressive: 7 attempts · Relaxed: 4 attempts. Circuit protection still applies.</p>
            {ep.role === "MEMBER" ? <Badge value={ep.retryPolicy} /> : <Select label="Retry policy" value={ep.retryPolicy} options={[{ value: "STANDARD", label: "Standard", description: "30s, 2m, 5m, 15m" }, { value: "AGGRESSIVE", label: "Aggressive", description: "30s, 30s, 30s, 2m, 2m, 5m" }, { value: "RELAXED", label: "Relaxed", description: "5m, 15m, 30m" }]} onChange={async retryPolicy => { try { await api(`/api/endpoints/${ep.id}/retry-policy`, { retryPolicy }, "PATCH"); await reload(); } catch(e) { setFailure((e as Error).message); } }} />}
            <p className="muted">Changes apply to subsequent failures. Already scheduled delays keep their due times.</p>
          </section>
          </Section><Section active={section} name="security"><details className="panel panel-body">
            <summary style={{ cursor: "pointer" }}><T text={"Endpoint configuration & signing secret"} /></summary>
            <div style={{ marginTop: 22 }}>
              <label><T text={"Subscribed event types"} /></label>
              <CodeBlock>{ep.eventTypes.join(", ")}</CodeBlock>
              {ep.secret && <>
              <label><T text={"HMAC signing secret"} /></label>
              <div className="secret-row">
                <code>{ep.secret}</code>
                <CopyButton value={ep.secret} />
              </div>
              <p className="muted" style={{ fontSize: 11 }}>
                Used to verify webhook-signature. Never expose this secret in
                client applications.
              </p>
              </>}
            </div>
          </details></Section>
        </>
      )}
    </Shell>
  );
}
