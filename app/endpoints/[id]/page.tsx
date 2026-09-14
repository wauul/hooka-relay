"use client";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Activity,
  Timer,
  Sparkles,
  Radio,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { useData, Badge, CopyButton, ErrorBox, Refresh } from "@/components/ui";
export default function Page({ params }: { params: { id: string } }) {
  const { data, error, reload } = useData<any>(
    `/api/endpoints/${params.id}/attempts`,
    true,
  );
  const ep = data?.endpoint;
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
      <ErrorBox error={error} />
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
          <details className="panel panel-body">
            <summary style={{ cursor: "pointer" }}>
              Endpoint configuration & signing secret
            </summary>
            <div style={{ marginTop: 22 }}>
              <label>Subscribed event types</label>
              <pre>{ep.eventTypes.join(", ")}</pre>
              <label>HMAC signing secret</label>
              <div className="secret-row">
                <code>{ep.secret}</code>
                <CopyButton value={ep.secret} />
              </div>
              <p className="muted" style={{ fontSize: 11 }}>
                Used to verify X-Webhook-Signature. Never expose this secret in
                client applications.
              </p>
            </div>
          </details>
        </>
      )}
    </Shell>
  );
}
